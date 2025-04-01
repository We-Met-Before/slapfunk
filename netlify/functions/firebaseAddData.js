const { messaging } = require("firebase-admin");
const { db } = require("./firebase");

const clientId = process.env.EVENTIX_CLIENT_ID;
const clientSecret = process.env.EVENTIX_CLIENT_SECRET;
const code = process.env.EVENTIX_CODE_KEY;
const companyId = process.env.EVENTIX_COMPANY_ID;

async function generateCouponCode(couponId, eventixToken, generatedCode, currentUser, itemId) {
    try {
        let accessTokenId = eventixToken[0].accessToken;

        // Prepare the request options
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
        // Handle unexpected errors
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message }),
        };
    }
}

async function generateAccessToken() {
    try {
        const options = {
            "method": "POST",
            "headers": {
                "Content-Type": "application/json",
            },
            "body": JSON.stringify({
                grant_type: "authorization_code",
                client_id: clientId, // Use environment variables for sensitive data
                client_secret: clientSecret,
                redirect_uri: "https://www.google.nl/", // Replace with your actual redirect URI
                code: code
            })
        };

        // Make the API request
        const response = await fetch("https://auth.openticket.tech/tokens", options);
        // Parse the API response
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
                client_id: clientId, // Use environment variables
                client_secret: clientSecret,
                refresh_token: eventixToken[0].refreshToken,
                grant_type: "refresh_token"
            })
        };

        // Make the API request
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

function getCorsHeaders(origin) {
    return {
        'Access-Control-Allow-Origin': origin || '*',
        'Access-Control-Allow-Headers': 'Content-Type, Accept, Origin, Authorization',
        'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
        'Access-Control-Max-Age': '86400',
        'Content-Type': 'application/json'
    }
}

async function validateToken(tokenData) {
    let tokenExpirationDate = tokenData[0].expiryDate._seconds * 1000; // Convert to ms
    let nowTimeStamp = Date.now();

    if (tokenExpirationDate > nowTimeStamp) {
        return true;
    } else {
        return false;
    }
}

async function validateUserDiscountCode(currentUserEmail, itemId) {
    let currentUserDataSnapshot = await db.collection('users').where('emailAddress', '==', currentUserEmail).get();
    let currentUserData = currentUserDataSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    // if (currentUserData.length && currentUserData[0].generatedCouponCode) {
    //     return false;
    // } else if (currentUserData.length && !currentUserData[0].generatedCouponCode) {
    //     return true;
    // }

    if (currentUserData.length && currentUserData[0].eventListDiscounted.includes(itemId)) {
        return false;
    } else if (currentUserData.length && !currentUserData[0].eventListDiscounted.includes(itemId)) {
        return true;
    }
}

async function checkUserInDb(currentUser) {
    let currentUserDataSnapshot = await db.collection('users').where('emailAddress', '==', currentUser.emailAddress.emailAddress).get();
    let currentUserData = currentUserDataSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    if (currentUserData.length) {
        return true;
    } else {
        let newUser = db.collection('users').add({
            emailAddress: currentUser.emailAddress.emailAddress,
            firstName: currentUser.firstName,
            lastName: currentUser.lastName,
            generatedCouponCode: false,
            eventListDiscounted: []
        })
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
        if (event.httpMethod === 'OPTIONS') {
            return {
                statusCode: 200,
                headers: getCorsHeaders(event.headers.origin)
            };
        }
        //EVENTIX DATA
        let eventixTokensSnapshot = await db.collection('eventixTokens').get();
        let eventixTokens = eventixTokensSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

        // // //USER DATA
        let currentUserData = JSON.parse(event.body);
        let usersSnapshot = await db.collection('users').where('emailAddress', '==', currentUserData.payload.emailAddress.emailAddress).get();
        let currentUser = usersSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));


        // //SUBSCRIPTION DATA
        let currentUserSubscriptionSnapshot = await db.collection('subscriptions').where('subscriptionName', '==', currentUserData.payload.subscriptionName).get();
        let currentUserSubscription = currentUserSubscriptionSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        let currentUserSubscriptionId = currentUserSubscription[0].subscriptionId;
        let currentUserSubscriptionName = currentUserSubscription[0].subscriptionName;

        let checkUserInDB = await checkUserInDb(currentUserData.payload);
        let tokenIsValid = await validateToken(eventixTokens);
        let validUserToGenerateCode = await validateUserDiscountCode(currentUserData.payload.emailAddress.emailAddress, currentUserData.payload.itemId);

        if (currentUserData.payload) {
            if (validUserToGenerateCode && tokenIsValid) {
                let generatedCouponCode = generateCode(currentUserSubscriptionName)
                let response = await generateCouponCode(currentUserSubscriptionId, eventixTokens, generatedCouponCode, currentUser, currentUserData.payload.itemId);

                if (generateCouponCode && response.statusCode == 200) {
                    return {
                        statusCode: 200,
                        headers: getCorsHeaders(event.headers.origin),
                        body: JSON.stringify({
                            couponCode: generatedCouponCode,
                            message: 'Hey, here is your Discount Code!'
                        }),
                    }
                }

            } else if (validUserToGenerateCode && !tokenIsValid) {
                let refreshTokenResponse = await refreshAccessToken(eventixTokens);
                let generatedCouponCode = generateCode(currentUserSubscriptionName)
                let response = await generateCouponCode(currentUserSubscriptionId, eventixTokens, generatedCouponCode, currentUser, currentUserData.payload.itemId);

                if (generateCouponCode && response.statusCode == 200) {
                    return {
                        statusCode: 200,
                        headers: getCorsHeaders(event.headers.origin),
                        body: JSON.stringify({
                            couponCode: generatedCouponCode,
                            message: 'Hey, here is your Discount Code!'
                        }),
                    }
                }
            } else if (!validUserToGenerateCode) {
                //display alert - user already generated coupon code
                return {
                    statusCode: 200,
                    headers: getCorsHeaders(event.headers.origin),
                    body: JSON.stringify({
                        couponCode: '',
                        message: 'Sorry, you already generated a Discount Code!'
                    }),
                }
            }
        }
    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message }),
        };
    }
};