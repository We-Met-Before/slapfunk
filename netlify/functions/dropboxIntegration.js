const { Dropbox } = require('dropbox');

// Common CORS headers to include in all responses
const headers = {
  "Access-Control-Allow-Origin": "*", // Replace "*" with your domain if you want to restrict access
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

exports.handler = async (event, context) => {
  // Handle preflight OPTIONS request
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers,
      body: ""
    };
  }

  // Define the Dropbox file path
  const filePath = '/discount_codes.json';
  const dbx = new Dropbox({ accessToken: process.env.DROPBOX_ACCESS_TOKEN });
  let currentUserData = JSON.parse(event.body);


  try {
    //check for user subscription
    let currentUserSubscriptionName = currentUserData.payload.subscriptionName;
    let eventNameParam = currentUserData.payload.eventName;
    const eventName = eventNameParam.toLowerCase();

    if (!currentUserSubscriptionName || !eventName) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'The user does not have an active subscription.' })
      };
    }

    // Download the discount codes file from Dropbox
    const downloadResponse = await dbx.filesDownload({ path: filePath });
    const fileContent = downloadResponse.result.fileBinary.toString('utf8');
    let discountData = JSON.parse(fileContent);

    const codesList = discountData.codes[eventName];

    // Look for the first available discount code
    let availableCode = codesList.find(item => item.status === "available" && item.tier.toLowerCase() === currentUserSubscriptionName.toLowerCase());
    if (!availableCode) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'No available discount codes.' })
      };
    }

    // Mark the code as used
    availableCode.status = "used";
    const updatedContent = JSON.stringify(discountData, null, 2);

    // After downloading the file and parsing its content:
    const rev = downloadResponse.result.rev;

    // Upload the updated file back to Dropbox (overwrite the existing file)
    await dbx.filesUpload({
      path: filePath,
      contents: updatedContent,
      mode: { ".tag": "update", update: rev }
    });

    // Return the discount code
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        code: availableCode.code,
        eventDetails: event
      })
    };

  } catch (error) {
    console.error('Error processing discount code:', JSON.stringify(error, null, 2));
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message, details: error.error_summary || error })
    };
  }
};
