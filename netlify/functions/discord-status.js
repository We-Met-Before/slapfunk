export async function handler(event) {
    // Allow only GET method
    if (event.httpMethod !== 'GET') {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: 'Method Not Allowed' })
      };
    }
  
    // Extract query param
    const shopifyId = event.queryStringParameters?.shopifyId;
  
    if (!shopifyId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing shopifyId' })
      };
    }
  
    try {
      // Fetch from the original API (backend-proxy)
      const res = await fetch(`https://discordapp.slapfunk.com/api/status?shopifyId=${shopifyId}`);
      const data = await res.json();
  
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'GET, OPTIONS'
        },
        body: JSON.stringify(data)
      };
    } catch (err) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Server Error', details: err.message })
      };
    }
  }
  