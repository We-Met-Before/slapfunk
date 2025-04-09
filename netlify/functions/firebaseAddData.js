// Import Firebase and Dropbox SDK
const { messaging } = require("firebase-admin");
const { db } = require("./firebase");
const { Dropbox } = require('dropbox');

// Environment variables for Eventix (unchanged)
const clientId = process.env.EVENTIX_CLIENT_ID;
const clientSecret = process.env.EVENTIX_CLIENT_SECRET;
const code = process.env.EVENTIX_CODE_KEY;
const companyId = process.env.EVENTIX_COMPANY_ID;

// -- Dropbox OAuth Environment Variables --
// Instead of a static token, we expect to use the full OAuth flow.
// Make sure you set these in your environment:
// - DROPBOX_CLIENT_ID
// - DROPBOX_CLIENT_SECRET
// - DROPBOX_REDIRECT_URI
//
// (If you previously used DROPBOX_ACCESS_TOKEN for testing, you can remove it.)
//
// For convenience, if you wish to keep a testing token fallback you can,
// but the full flow is handled below.
const staticDropboxToken = process.env.DROPBOX_ACCESS_TOKEN || null;

// -----------------------------------------------------------------
// HELPER FUNCTIONS
// -----------------------------------------------------------------

// CORS headers helper function
function getCorsHeaders(origin) {
    return {
        'Access-Control-Allow-Origin': origin || '*',
        'Access-Control-Allow-Headers': 'Content-Type, Accept, Origin, Authorization',
        'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
        'Access-Control-Max-Age': '86400',
        'Content-Type': 'application/json'
    };
}

// -----------------------------------------------------------------
// DROPBOX OAUTH FLOW FUNCTIONS
// -----------------------------------------------------------------

// 1. Build the Dropbox authorization URL
//    Redirect your user to this URL so they can authorize your app.
// function getDropboxAuthUrl() {
//     const dropboxClientId = process.env.DROPBOX_CLIENT_ID;
//     const redirectUri = process.env.DROPBOX_REDIRECT_URI; // e.g., "https://your-domain.com/dropbox-auth-callback"
//     const authUrl = `https://www.dropbox.com/oauth2/authorize?response_type=code&client_id=${dropboxClientId}&redirect_uri=${encodeURIComponent(redirectUri)}&token_access_type=offline`;
//     return authUrl;
// }

// 2. Handle Dropbox callback: Exchange the authorization code for tokens
//    This endpoint should be called by Dropbox via the redirect URI after the user authorizes.
// async function handleDropboxAuthCallback(authCode) {
//     const dropboxClientId = process.env.DROPBOX_CLIENT_ID;
//     const dropboxClientSecret = process.env.DROPBOX_CLIENT_SECRET;
//     const redirectUri = process.env.DROPBOX_REDIRECT_URI;
//     const tokenUrl = "https://api.dropbox.com/oauth2/token";

//     const params = new URLSearchParams();
//     params.append("code", authCode);
//     params.append("grant_type", "authorization_code");
//     params.append("client_id", dropboxClientId);
//     params.append("client_secret", dropboxClientSecret);
//     params.append("redirect_uri", redirectUri);

//     const response = await fetch(tokenUrl, {
//         method: "POST",
//         headers: { "Content-Type": "application/x-www-form-urlencoded" },
//         body: params.toString()
//     });
//     const tokenData = await response.json();

//     // Save tokenData in Firestore – here we use a fixed document ID "appToken" in the "dropboxTokens" collection.
//     await db.collection("dropboxTokens").doc("appToken").set({
//         access_token: tokenData.access_token,
//         refresh_token: tokenData.refresh_token,
//         // Save the expiry time (current time + expires_in ms)
//         expiryTime: Date.now() + (tokenData.expires_in * 1000)
//     });
//     return tokenData;
// }

// 3. Refresh the Dropbox access token using the refresh token
async function refreshDropboxAccessToken(refreshToken) {
    const dropboxClientId = process.env.DROPBOX_CLIENT_ID;
    const dropboxClientSecret = process.env.DROPBOX_CLIENT_SECRET;
    const tokenUrl = "https://api.dropbox.com/oauth2/token";

    const params = new URLSearchParams();
    params.append("refresh_token", refreshToken);
    params.append("grant_type", "refresh_token");
    params.append("client_id", dropboxClientId);
    params.append("client_secret", dropboxClientSecret);

    const response = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString()
    });
    const data = await response.json();
    return data;
}

// 4. Get a valid Dropbox client by checking token expiry and refreshing if necessary
async function getValidDropboxClient() {
    // Try to retrieve token data from the Firestore collection "dropboxTokens"
    const tokenDoc = await db.collection("dropboxTokens").doc("appToken").get();
    if (!tokenDoc.exists) {
        // If not found and a static token is set from env (testing mode), use that.
        if (staticDropboxToken) {
            return new Dropbox({ accessToken: staticDropboxToken });
        }
        throw new Error("Dropbox token not configured");
    }
    let tokenData = tokenDoc.data();

    // Check expiry (assume expiryTime is stored in milliseconds)
    if (Date.now() >= tokenData.expiryTime) {
        // Token expired; refresh it using the stored refresh token
        const newTokenData = await refreshDropboxAccessToken(tokenData.refresh_token);
        tokenData.access_token = newTokenData.access_token;
        tokenData.expiryTime = Date.now() + (newTokenData.expires_in * 1000);
        // Update Firestore with the new access token and expiryTime
        await db.collection("dropboxTokens").doc("appToken").update({
            access_token: tokenData.access_token,
            expiryTime: tokenData.expiryTime,
        });
    }

    // Return a new Dropbox client using the valid access token
    return new Dropbox({ accessToken: tokenData.access_token });
}

// -----------------------------------------------------------------
// EXISTING FUNCTIONS (DROPBOX & EVENTIX INTEGRATIONS)
// -----------------------------------------------------------------

async function generateCouponCodeDropbox(currentUserData, currentUser, itemId) {
    try {
        const filePath = '/discount_codes.json';
        // Instead of using a static token, get a valid Dropbox client
        const dbx = await getValidDropboxClient();

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
    } catch (error) {
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
    let couponCode = "SF-" + subscriptionName.toUpperCase() + '-';
    for (let i = 0; i < 10; i++) {
        const randomIndex = Math.floor(Math.random() * characters.length);
        couponCode += characters[randomIndex];
    }
    return couponCode;
}

// -----------------------------------------------------------------
// MAIN HANDLER FUNCTION
// -----------------------------------------------------------------

exports.handler = async (event) => {
    try {
        // Handle CORS preflight requests
        if (event.httpMethod === 'OPTIONS') {
            return {
                statusCode: 200,
                headers: getCorsHeaders(event.headers.origin)
            };
        }

        // Retrieve Eventix tokens from Firestore
        let eventixTokensSnapshot = await db.collection('eventixTokens').get();
        let eventixTokens = eventixTokensSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Parse user data from the request body
        let currentUserData = JSON.parse(event.body);
        let usersSnapshot = await db.collection('users')
            .where('emailAddress', '==', currentUserData.payload.emailAddress.emailAddress)
            .get();
        let currentUser = usersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Retrieve subscription data from Firestore
        let currentUserSubscriptionSnapshot = await db.collection('subscriptions')
            .where('subscriptionName', '==', currentUserData.payload.subscriptionName)
            .get();
        let currentUserSubscription = currentUserSubscriptionSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        let currentUserSubscriptionId = currentUserSubscription[0].subscriptionId;
        let currentUserSubscriptionName = currentUserSubscription[0].subscriptionName;

        // Ensure the user exists in our DB
        await checkUserInDb(currentUserData.payload);

        // Validate if the user is allowed to generate a new coupon code
        let validUserToGenerateCode = await validateUserDiscountCode(
            currentUserData.payload.emailAddress.emailAddress,
            currentUserData.payload.itemId
        );

        // -----------------------------------------------------------------
        // Processing for Eventix Events
        // -----------------------------------------------------------------
        if (currentUserData.payload.isEventixEvent === 'True' || currentUserData.payload.isEventixEvent == null) {
            // Here we check if the token is valid for Eventix and then call generateCouponCode accordingly.
            let tokenIsValid = await validateToken(eventixTokens);
            if (validUserToGenerateCode && tokenIsValid) {
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
        }
        // -----------------------------------------------------------------
        // Processing for Non‑Eventix Events using Dropbox Integration
        // -----------------------------------------------------------------
        else {
            // For non-Eventix events, use Dropbox integration.
            // We first validate if the user is allowed to generate a coupon code.
            if (validUserToGenerateCode) {
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
                            // The Dropbox function returns a coupon code in its JSON body.
                            couponCode: JSON.parse(response.body).code,
                            message: 'Hey, here is your Discount Code!'
                        }),
                    };
                } else {
                    return {
                        statusCode: response.statusCode || 500,
                        headers: getCorsHeaders(event.headers.origin),
                        body: response.body || JSON.stringify({ error: 'An unknown error occurred.' })
                    };
                }
            } else {
                return {
                    statusCode: 200,
                    headers: getCorsHeaders(event.headers.origin),
                    body: JSON.stringify({
                        couponCode: '',
                        message: 'Sorry, you already generated a Discount Code!'
                    }),
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

