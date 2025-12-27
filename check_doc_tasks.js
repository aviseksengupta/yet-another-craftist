const axios = require('axios');
require('dotenv').config();

const client = axios.create({
  baseURL: 'https://api.craft.do',
  headers: {
    'Authorization': `Bearer ${process.env.CRAFT_API_KEY}`,
    'Content-Type': 'application/json',
  },
});

async function checkDocTasks() {
  try {
    // Check tasks in Getting Started document (a3652f82-e45f-e679-d09e-ff6c7f8d2dba)
    console.log('Checking tasks in Getting Started document...');
    const response = await client.post('/tasks', {
      operation: 'query',
      scope: 'document',
      documentId: 'a3652f82-e45f-e679-d09e-ff6c7f8d2dba'
    });
    console.log(`Found ${response.data.items?.length || 0} tasks`);
    if (response.data.items?.length > 0) {
      response.data.items.forEach(task => {
        console.log(`  - ${task.markdown} (ID: ${task.id}, state: ${task.state})`);
      });
    }
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

checkDocTasks();
