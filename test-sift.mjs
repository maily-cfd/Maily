import { OpenRouterAIService } from './lib/openrouter-ai.js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function test() {
  const ai = new OpenRouterAIService();
  
  const mockEmails = [
    { id: 'e1', from: 'vc-partner@sequoia.com', subject: 'Investment Proposal / Partnership', snippet: 'Great meeting you yesterday. We would like to follow up with a seed-round investment proposal of $1.5M.' },
    { id: 'e2', from: 'production-alert@aws.amazon.com', subject: 'CRITICAL ALERT: Production server down (us-east-1)', snippet: 'Your server instance i-091fhas7f has failed health checks and is unreachable. Immediate action required.' },
    { id: 'e3', from: 'johndoe@gmail.com', subject: 'Question about your API pricing / Demo request', snippet: 'Hi, I saw Maily on Product Hunt. Can we schedule a demo call tomorrow to discuss enterprise pricing for our team of 50?' },
    { id: 'e4', from: 'billing@supabase.io', subject: 'Upcoming invoice for database usage', snippet: 'Your upcoming invoice of $25.00 for project nelscyaohnr will be charged on May 15, 2026.' },
    { id: 'e5', from: 'promotions@groupon.com', subject: '50% off local sushi deals near you!', snippet: 'Hungry? Check out these amazing local deals with discounts up to 50% for this weekend only.' }
  ];

  console.log("🚀 Testing generateInboxIntelligence...");
  try {
    const result = await ai.generateInboxIntelligence(mockEmails, false);
    console.log("🎉 SUCCESS!");
    console.log("Result:", JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("❌ FAILED:", err);
  }
}

test();
