require('dotenv').config();
const { MongoClient } = require('mongodb');

async function find() {
  const client = new MongoClient(process.env.MONGODB_URI.trim());
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_NAME.trim());
  
  const user = await db.collection('users').findOne({ email: 'soorya.r@techins60.com' });
  
  if (user) {
    console.log('Found soorya.r@techins60.com:');
    console.log(JSON.stringify(user, null, 2));
  } else {
    console.log('NOT FOUND: soorya.r@techins60.com');
  }
  
  // Check with different casing
  const userUpper = await db.collection('users').findOne({ email: 'Soorya.R@techins60.com' });
  if (userUpper) {
    console.log('\nFound with different casing:');
    console.log(JSON.stringify(userUpper, null, 2));
  }
  
  // Check all students with "soorya" in email
  const matches = await db.collection('users').find({ 
    email: { $regex: 'soorya', $options: 'i' }
  }).toArray();
  
  console.log(`\nAll users matching "soorya": ${matches.length}`);
  matches.forEach(m => console.log(`- ${m.email}`));
  
  await client.close();
}

find().catch(console.error);
