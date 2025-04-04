const { Dropbox } = require('dropbox');

// Common CORS headers to include in all responses
const headers = {
  'Access-Control-Allow-Origin': origin || '*',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Origin, Authorization',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
  'Content-Type': 'application/json'
};

exports.handler = async (event, context) => {
  // Handle preflight OPTIONS request
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: getCorsHeaders(event.headers.origin)
    };
  }

  // Extract the 'tier' parameter from query string
  let currentUserData = JSON.parse(event.body);
  const userTier = currentUserData.payload.subscriptionName;
  if (!userTier) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Missing tier parameter' })
    };
  }

  // Define the Dropbox file path
  const filePath = '/discount_codes.json';
  const dbx = new Dropbox({ accessToken: process.env.DROPBOX_ACCESS_TOKEN });

  try {
    // Download the discount codes file from Dropbox
    const downloadResponse = await dbx.filesDownload({ path: filePath });
    const fileContent = downloadResponse.result.fileBinary.toString('utf8');
    let discountData = JSON.parse(fileContent);

    // Look for the first available discount code that matches the user's tier
    let availableCode = discountData.codes.find(item =>
      item.status === "available" &&
      item.tier.toLowerCase() === userTier.toLowerCase()
    );

    if (!availableCode) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: `No available discount codes for tier: ${userTier}` })
      };
    }

    // Mark the found code as used
    availableCode.status = "used";
    const updatedContent = JSON.stringify(discountData, null, 2);

    // Get the file revision from the download response to use in the update mode
    const rev = downloadResponse.result.rev;

    // Upload the updated file back to Dropbox (update mode with current revision)
    await dbx.filesUpload({
      path: filePath,
      contents: updatedContent,
      mode: { ".tag": "update", update: rev }
    });

    // Return the discount code to the client
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ code: availableCode.code })
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
