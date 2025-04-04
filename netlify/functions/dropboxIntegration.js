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
  const filePath = '/Apps/MyApp/discount_codes.json';
  const dbx = new Dropbox({ accessToken: process.env.DROPBOX_ACCESS_TOKEN });

  try {
    // Download the discount codes file from Dropbox
    const downloadResponse = await dbx.filesDownload({ path: filePath });
    const fileContent = downloadResponse.result.fileBinary.toString('utf8');
    let discountData = JSON.parse(fileContent);

    // Look for the first available discount code
    let availableCode = discountData.codes.find(item => item.status === "available");
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

    // Upload the updated file back to Dropbox (overwrite the existing file)
    await dbx.filesUpload({
      path: filePath,
      contents: updatedContent,
      mode: { ".tag": "overwrite" }
    });

    // Return the discount code
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ code: availableCode.code })
    };

  } catch (error) {
    console.error('Error processing discount code:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
