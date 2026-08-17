const { Resend } = require('resend');

// Load env variables manually from .env.local
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const envPath = path.resolve(__dirname, '../.env.local');
if (fs.existsSync(envPath)) {
  const envConfig = dotenv.parse(fs.readFileSync(envPath));
  for (const k in envConfig) {
    process.env[k] = envConfig[k];
  }
}

const resend = new Resend(process.env.RESEND_API_KEY);

async function test() {
  console.log('Using Resend API Key:', process.env.RESEND_API_KEY ? 'Set' : 'Not Set');
  try {
    const { data, error } = await resend.emails.send({
      from: 'Mailient Access <support@mailient.xyz>',
      to: ['support.maily@gmail.com'],
      replyTo: 'test@example.com',
      subject: 'Test email from access request script',
      html: '<p>This is a test to verify if support@mailient.xyz works.</p>',
    });

    if (error) {
      console.error('Resend Error:', error);
    } else {
      console.log('Resend Success! Data:', data);
    }
  } catch (err) {
    console.error('Catch Error:', err);
  }
}

test();
