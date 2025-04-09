const { messaging } = require("firebase-admin");
const { db } = require("./firebase");
const { Dropbox } = require('dropbox');

// Environment variables for Eventix and Dropbox
const clientId = process.env.EVENTIX_CLIENT_ID;
const clientSecret = process.env.EVENTIX_CLIENT_SECRET;
const code = process.env.EVENTIX_CODE_KEY;
const companyId = process.env.EVENTIX_COMPANY_ID;
const dropboxToken = process.env.DROPBOX_ACCESS_TOKEN;

// Helper function for CORS headers
function getCorsHeaders(origin) {
    return {
        'Access-Control-Allow-Origin': origin || '*',
        'Access-Control-Allow-Headers': 'Content-Type, Accept, Origin, Authorization',
        'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
        'Access-Control-Max-Age': '86400',
        'Content-Type': 'application/json'
    };
}

async function generateCouponCodeDropbox(currentUserData, currentUser, itemId) {
    try {
        const filePath = '/discount_codes.json';
        const dbx = new Dropbox({ accessToken: dropboxToken });

        // Retrieve subscription and event name (we use itemId as event name)
        let currentUserSubscriptionName = currentUserData.payload.subscriptionName;
        const eventName = itemId.toLowerCase();

        if (!currentUserSubscriptionName || !eventName) {
            return {
                statusCode: 404,
                body: JSON.stringify({ error: 'The user does not have an active subscription.' })
            };
        }

        // Download discount codes file from Dropbox
        const downloadResponse = await dbx.filesDownload({ path: filePath });
        const fileContent = downloadResponse.result.fileBinary.toString('utf8');
        let discountData = JSON.parse(fileContent);

        // Get the list of codes for this event from the new JSON structure
        const codesList = discountData.codes[eventName];
        if (!codesList || !Array.isArray(codesList)) {
            return {
                statusCode: 404,
                body: JSON.stringify({ error: `No codes available for event: ${eventName}` })
            };
        }

        // Look for the first available discount code for the matching tier
        let availableCode = codesList.find(item =>
            item.status === "available" &&
            item.tier.toLowerCase() === currentUserSubscriptionName.toLowerCase()
        );
        if (!availableCode) {
            return {
                statusCode: 404,
                body: JSON.stringify({ error: 'No available discount codes.' })
            };
        }

        // Mark the found code as used
        availableCode.status = "used";
        const updatedContent = JSON.stringify(discountData, null, 2);

        // Get current revision from download response
        const rev = downloadResponse.result.rev;

        // Upload the updated file back to Dropbox in update mode
        await dbx.filesUpload({
            path: filePath,
            contents: updatedContent,
            mode: { ".tag": "update", update: rev }
        });

        // Update the user record in Firestore
        const id = currentUser[0].id;
        currentUser[0].eventListDiscounted.push(itemId);
        const updateObj = {
            generatedCouponCode: true,
            eventListDiscounted: currentUser[0].eventListDiscounted
        };
        if (id && updateObj) {
            await db.collection("users").doc(id).update(updateObj);
        }

        // Return the discount code
        return {
            statusCode: 200,
            body: JSON.stringify({ code: availableCode.code })
        };
    }
    catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message, details: error.error_summary || error })
        };
    }
}

async function generateCouponCode(couponId, eventixToken, generatedCode, currentUser, itemId) {
    try {
        let accessTokenId = eventixToken[0].accessToken;

        // Prepare the request options for Eventix API
        const url = `https://api.eventix.io/coupon/${couponId}/codes`;
        const options = {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${accessTokenId}`,
                "Company": companyId,
            },
            body: JSON.stringify({
                codes: [
                    {
                        code: generatedCode,
                        applies_to_count: 1,
                    },
                ],
                applies_to_count: 1,
            }),
        };

        // Make the API call
        const response = await fetch(url, options);
        const data = await response.json();

        // Update user record in Firestore
        const id = currentUser[0].id;
        currentUser[0].eventListDiscounted.push(itemId);
        const updateObj = {
            generatedCouponCode: true,
            eventListDiscounted: currentUser[0].eventListDiscounted
        };
        if (id && updateObj && data) {
            await db.collection("users").doc(id).update(updateObj);
        }

        return {
            statusCode: 200,
            body: JSON.stringify(data)
        };

    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message }),
        };
    }
}

async function generateAccessToken() {
    try {
        const options = {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                grant_type: "authorization_code",
                client_id: clientId,
                client_secret: clientSecret,
                redirect_uri: "https://www.google.nl/", // Replace with your actual redirect URI
                code: code
            })
        };

        const response = await fetch("https://auth.openticket.tech/tokens", options);
        const responseData = await response.json();
        return responseData;
    }
    catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message }),
        };
    }
}

async function refreshAccessToken(eventixToken) {
    try {
        const options = {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                client_id: clientId,
                client_secret: clientSecret,
                refresh_token: eventixToken[0].refreshToken,
                grant_type: "refresh_token"
            })
        };

        const response = await fetch("https://auth.openticket.tech/tokens", options);
        const data = await response.json();

        const id = eventixToken[0].id;
        const updateObj = {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiryDate: new Date(Date.now() + data.expires_in * 1000)
        };
        if (id && updateObj && data) {
            await db.collection("eventixTokens").doc(id).update(updateObj);
        }

        return {
            statusCode: 200,
            body: JSON.stringify(data),
        };
    }
    catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message }),
        };
    }
}

async function validateToken(tokenData) {
    let tokenExpirationDate = tokenData[0].expiryDate._seconds * 1000; // Convert to ms
    let nowTimeStamp = Date.now();
    return tokenExpirationDate > nowTimeStamp;
}

async function validateUserDiscountCode(currentUserEmail, itemId) {
    let currentUserDataSnapshot = await db.collection('users')
        .where('emailAddress', '==', currentUserEmail).get();
    let currentUserData = currentUserDataSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    if (currentUserData.length && currentUserData[0].eventListDiscounted.includes(itemId)) {
        return false;
    } else if (currentUserData.length && !currentUserData[0].eventListDiscounted.includes(itemId)) {
        return true;
    }
}

async function checkUserInDb(currentUser) {
    let currentUserDataSnapshot = await db.collection('users')
        .where('emailAddress', '==', currentUser.emailAddress.emailAddress).get();
    let currentUserData = currentUserDataSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    if (currentUserData.length) {
        return true;
    } else {
        await db.collection('users').add({
            emailAddress: currentUser.emailAddress.emailAddress,
            firstName: currentUser.firstName,
            lastName: currentUser.lastName,
            generatedCouponCode: false,
            eventListDiscounted: []
        });
        return false;
    }
}

function generateCode(subscriptionName) {
    const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let code = "SF-" + subscriptionName.toUpperCase() + '-';
    for (let i = 0; i < 10; i++) {
        const randomIndex = Math.floor(Math.random() * characters.length);
        code += characters[randomIndex];
    }
    return code;
}

exports.handler = async (event) => {
    try {
        // Handle CORS preflight requests
        if (event.httpMethod === 'OPTIONS') {
            return {
                statusCode: 200,
                headers: getCorsHeaders(event.headers.origin)
            };
        }
        // Get Eventix tokens from DB
        let eventixTokensSnapshot = await db.collection('eventixTokens').get();
        let eventixTokens = eventixTokensSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Parse user data from request
        let currentUserData = JSON.parse(event.body);
        let usersSnapshot = await db.collection('users')
            .where('emailAddress', '==', currentUserData.payload.emailAddress.emailAddress)
            .get();
        let currentUser = usersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Get subscription data from DB
        let currentUserSubscriptionSnapshot = await db.collection('subscriptions')
            .where('subscriptionName', '==', currentUserData.payload.subscriptionName)
            .get();
        let currentUserSubscription = currentUserSubscriptionSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        let currentUserSubscriptionId = currentUserSubscription[0].subscriptionId;
        let currentUserSubscriptionName = currentUserSubscription[0].subscriptionName;

        await checkUserInDb(currentUserData.payload);
        let tokenIsValid = await validateToken(eventixTokens);
        let validUserToGenerateCode = await validateUserDiscountCode(
            currentUserData.payload.emailAddress.emailAddress,
            currentUserData.payload.itemId
        );

        // When Eventix event
        if (currentUserData.payload.isEventixEvent === 'True') {
            if (validUserToGenerateCode && tokenIsValid) {
                let generatedCouponCode = generateCode(currentUserSubscriptionName);
                // Await the async call!
                let response = await generateCouponCode(
                    currentUserSubscriptionId,
                    eventixTokens,
                    generatedCouponCode,
                    currentUser,
                    currentUserData.payload.itemId
                );
                if (response && response.statusCode === 200) {
                    return {
                        statusCode: 200,
                        headers: getCorsHeaders(event.headers.origin),
                        body: JSON.stringify({
                            couponCode: generatedCouponCode,
                            message: 'Hey, here is your Discount Code!'
                        }),
                    };
                }
            } else if (validUserToGenerateCode && !tokenIsValid) {
                await refreshAccessToken(eventixTokens);
                let generatedCouponCode = generateCode(currentUserSubscriptionName);
                let response = await generateCouponCode(
                    currentUserSubscriptionId,
                    eventixTokens,
                    generatedCouponCode,
                    currentUser,
                    currentUserData.payload.itemId
                );
                if (response && response.statusCode === 200) {
                    return {
                        statusCode: 200,
                        headers: getCorsHeaders(event.headers.origin),
                        body: JSON.stringify({
                            couponCode: generatedCouponCode,
                            message: 'Hey, here is your Discount Code!'
                        }),
                    };
                }
            } else if (!validUserToGenerateCode) {
                return {
                    statusCode: 200,
                    headers: getCorsHeaders(event.headers.origin),
                    body: JSON.stringify({
                        couponCode: '',
                        message: 'Sorry, you already generated a Discount Code!'
                    }),
                };
            }
        } else {
            // For non-Eventix events, use Dropbox integration.
            let response = await generateCouponCodeDropbox(
                currentUserData,
                currentUser,
                currentUserData.payload.itemId
            );
            if (response && response.statusCode === 200) {
                return {
                    statusCode: 200,
                    headers: getCorsHeaders(event.headers.origin),
                    body: JSON.stringify({
                        couponCode: JSON.parse(response.body).code,
                        message: 'Hey, here is your Discount Code!'
                    }),
                };
            } else {
                // Return the response object wrapped with appropriate CORS headers.
                return {
                    statusCode: response.statusCode || 500,
                    headers: getCorsHeaders(event.headers.origin),
                    body: response.body || JSON.stringify({ error: 'An unknown error occurred.' })
                };
            }
        }
    } catch (error) {
        return {
            statusCode: 500,
            headers: getCorsHeaders(event.headers.origin),
            body: JSON.stringify({ error: error.message }),
        };
    }
};
