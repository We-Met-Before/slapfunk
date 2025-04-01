const { Dropbox } = require('dropbox');

exports.handler = async (event, context) => {
<<<<<<< HEAD
  // Define the file path in Dropbox
  const filePath = '/discount_codes.json';
  
  // Initialize Dropbox client with the access token stored in environment variables
  const dbx = new Dropbox({ accessToken: process.env.DROPBOX_ACCESS_TOKEN });
  
  try {
    // Download the JSON file from Dropbox
    const downloadResponse = await dbx.filesDownload({ path: filePath });
    const fileContent = downloadResponse.result.fileBinary.toString('utf8');
    let discountData = JSON.parse(fileContent);

    // Find the first available discount code
    let availableCode = discountData.codes.find(item => item.status === "available");
    if (!availableCode) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'No available discount codes.' }),
      };
    }

    // Mark the code as used
    availableCode.status = "used";

    // Prepare updated file content
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
      body: JSON.stringify({ code: availableCode.code }),
    };

  } catch (error) {
    console.error('Error in discount code processing:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
=======
    // Define the file path in Dropbox
    const filePath = '/discount_codes.json';

    // Initialize Dropbox client with the access token stored in environment variables
    const dbx = new Dropbox({ accessToken: process.env.DROPBOX_ACCESS_TOKEN });

    try {
        // Download the JSON file from Dropbox
        const downloadResponse = await dbx.filesDownload({ path: filePath });
        const fileContent = downloadResponse.result.fileBinary.toString('utf8');
        let discountData = JSON.parse(fileContent);

        // Find the first available discount code
        let availableCode = discountData.codes.find(item => item.status === "available");
        if (!availableCode) {
            return {
                statusCode: 404,
                body: JSON.stringify({ error: 'No available discount codes.' }),
            };
        }

        // Mark the code as used
        availableCode.status = "used";

        // Prepare updated file content
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
            body: JSON.stringify({ code: availableCode.code }),
        };

    } catch (error) {
        console.error('Error in discount code processing:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message }),
        };
    }
>>>>>>> 26a2bc00650dfb0a5f24c2cd1b40fbffef5e0ad0
};
