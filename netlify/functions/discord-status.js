// Netlify serverless function: discord-status.js

export async function handler(event, context) {
    // Enable CORS for Webflow frontend
    const headers = {
      'Access-Control-Allow-Origin': 'https://wmb-slapfunk.webflow.io',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
  
    // Handle CORS preflight request
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 200,
        headers,
        body: 'OK (CORS preflight)',
      };
    }
  
    // Only allow GET requests
    if (event.httpMethod !== 'GET') {
      return {
        statusCode: 405,
        headers,
        body: JSON.stringify({ error: 'Method Not Allowed' }),
      };
    }
  
    // Extract Shopify ID from query string
    const shopifyId = event.queryStringParameters?.shopifyId;
    if (!shopifyId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing shopifyId' }),
      };
    }
  
    try {
      // Make the actual request to your Discord backend (replace with real URL)
      const response = await fetch(`https://discordapp.slapfunk.com/api/status?shopifyId=${shopifyId}`);
      const data = await response.json();
  
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(data),
      };
    } catch (error) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to fetch Discord status' }),
      };
    }
  }
  