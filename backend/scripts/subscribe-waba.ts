import dotenv from 'dotenv';
import axios from 'axios';
dotenv.config();

const WABA_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
const TOKEN = process.env.WHATSAPP_TOKEN;

if (!WABA_ID || !TOKEN) {
    console.error('Missing WHATSAPP_BUSINESS_ACCOUNT_ID or WHATSAPP_TOKEN in .env');
    process.exit(1);
}

async function subscribeWABA() {
    try {
        const response = await axios.post(
            `https://graph.facebook.com/v25.0/${WABA_ID}/subscribed_apps`,
            {},
            { headers: { Authorization: `Bearer ${TOKEN}` } }
        );
        console.log('✅App successfully subscribed to WABA:', response.data);
    } catch (err: any) {
        console.error('Failed to subscribe:', err.response?.data || err.message);
    }
}

subscribeWABA();
