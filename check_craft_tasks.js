const axios = require('axios');
require('dotenv').config();

const client = axios.create({
  baseURL: 'https://api.craft.do',
  headers: {
    'Authorization': `Bearer ${process.env.CRAFT_API_KEY}`,
    'Content-Type': 'application/json',
  },
});

async function checkTasks() {
  try {
    console.log('Checking active tasks...');
    const response = await client.get('/tasks', {
      params: { scope: 'active' }
    });
    console.log(`Found ${response.data.items?.length || 0} active tasks in Craft`);
    if (response.data.items?.length > 0) {
      response.data.items.forEach(task => {
        console.log(`  - ${task.markdown} (ID: ${task.id})`);
      });
    }
    
    console.log('\nChecking inbox tasks...');
    const inboxResponse = await client.get('/tasks', {
      params: { scope: 'inbox' }
    });
    console.log(`Found ${inboxResponse.data.items?.length || 0} inbox tasks`);
    
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

checkTasks();
