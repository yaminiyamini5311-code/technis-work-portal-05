#!/usr/bin/env node
/**
 * Deployment Verification Script
 * 
 * Checks if the deployed frontend and backend are properly configured.
 * Run this after deployment to quickly diagnose configuration issues.
 * 
 * Usage:
 *   node verify-deployment.js https://your-frontend.vercel.app https://your-backend.vercel.app
 */

const https = require('https');
const http = require('http');

// Color output for terminal
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  bold: '\x1b[1m'
};

function log(message, color = '') {
  console.log(`${color}${message}${colors.reset}`);
}

function success(message) {
  log(`✅ ${message}`, colors.green);
}

function error(message) {
  log(`❌ ${message}`, colors.red);
}

function warning(message) {
  log(`⚠️  ${message}`, colors.yellow);
}

function info(message) {
  log(`ℹ️  ${message}`, colors.blue);
}

async function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    
    client.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ 
            status: res.statusCode, 
            data: JSON.parse(data),
            headers: res.headers
          });
        } catch (e) {
          resolve({ 
            status: res.statusCode, 
            data: data,
            headers: res.headers,
            parseError: true
          });
        }
      });
    }).on('error', reject);
  });
}

async function checkBackend(backendUrl) {
  log('\n📡 Checking Backend API...', colors.bold);
  
  // Check basic health
  try {
    const health = await fetchJson(`${backendUrl}/api/health`);
    
    if (health.status === 200 && health.data.success) {
      success('Backend is reachable and responding');
      info(`Environment: ${health.data.env || 'unknown'}`);
    } else {
      error(`Backend returned status ${health.status}`);
      console.log(JSON.stringify(health.data, null, 2));
      return false;
    }
  } catch (err) {
    error(`Cannot reach backend: ${err.message}`);
    warning('Check that the backend URL is correct and deployed');
    return false;
  }
  
  // Check configuration
  try {
    const config = await fetchJson(`${backendUrl}/api/health?check=config`);
    
    if (config.status === 200 && config.data.success) {
      success('Required environment variables are set');
    } else if (config.status === 503 && config.data.missing_env) {
      error('Missing required environment variables:');
      config.data.missing_env.forEach(v => console.log(`   - ${v}`));
      warning('Add these in Vercel → Settings → Environment Variables');
      return false;
    }
  } catch (err) {
    warning(`Could not check config: ${err.message}`);
  }
  
  // Check database
  try {
    const db = await fetchJson(`${backendUrl}/api/health?check=db`);
    
    if (db.status === 200 && db.data.database?.connected) {
      success('Database connection is working');
      if (db.data.database.userCount !== undefined) {
        info(`Database has ${db.data.database.userCount} users`);
      }
    } else {
      error('Database connection failed');
      if (db.data.database?.error) {
        console.log(`   ${db.data.database.error}`);
      }
      warning('Check MONGODB_URI and MongoDB Atlas IP allowlist (0.0.0.0/0)');
      return false;
    }
  } catch (err) {
    warning(`Could not check database: ${err.message}`);
  }
  
  return true;
}

async function checkFrontend(frontendUrl, backendUrl) {
  log('\n🌐 Checking Frontend...', colors.bold);
  
  try {
    const response = await fetchJson(frontendUrl);
    
    if (response.status === 200) {
      success('Frontend is deployed and accessible');
    } else {
      error(`Frontend returned status ${response.status}`);
      return false;
    }
  } catch (err) {
    error(`Cannot reach frontend: ${err.message}`);
    warning('Check that the frontend URL is correct and deployed');
    return false;
  }
  
  info('Note: Check browser DevTools for runtime errors');
  info('      VITE_API_URL is inlined at build time - check build logs');
  
  return true;
}

async function checkCORS(frontendUrl, backendUrl) {
  log('\n🔒 CORS Configuration Check...', colors.bold);
  
  info(`Frontend: ${frontendUrl}`);
  info(`Backend:  ${backendUrl}`);
  
  warning('CORS check must be done in browser (preflight OPTIONS request)');
  warning('To verify CORS:');
  console.log(`   1. Open ${frontendUrl} in browser`);
  console.log(`   2. Open DevTools → Console`);
  console.log(`   3. Look for CORS errors`);
  console.log(`   4. If blocked, add to backend CORS_ORIGINS: ${frontendUrl}`);
}

async function checkEndpoints(backendUrl) {
  log('\n🔍 Checking Critical Endpoints...', colors.bold);
  
  const endpoints = [
    { path: '/api/health', public: true },
    { path: '/api/admin/stats', public: false, note: 'Requires authentication' },
  ];
  
  for (const endpoint of endpoints) {
    const url = `${backendUrl}${endpoint.path}`;
    try {
      const response = await fetchJson(url);
      
      if (endpoint.public) {
        if (response.status === 200) {
          success(`${endpoint.path} - OK`);
        } else {
          error(`${endpoint.path} - Status ${response.status}`);
        }
      } else {
        if (response.status === 401) {
          success(`${endpoint.path} - Protected (returns 401 as expected)`);
        } else if (response.status === 200) {
          warning(`${endpoint.path} - Returns 200 without auth (security issue?)`);
        } else {
          error(`${endpoint.path} - Status ${response.status}`);
        }
      }
    } catch (err) {
      error(`${endpoint.path} - ${err.message}`);
    }
  }
}

async function main() {
  const [frontendUrl, backendUrl] = process.argv.slice(2);
  
  if (!frontendUrl || !backendUrl) {
    console.log('Usage: node verify-deployment.js <frontend-url> <backend-url>');
    console.log('');
    console.log('Example:');
    console.log('  node verify-deployment.js \\');
    console.log('    https://technis-work-portal-05.vercel.app \\');
    console.log('    https://technis-portal-server.vercel.app');
    process.exit(1);
  }
  
  log('═══════════════════════════════════════════════', colors.bold);
  log('  TECHINS Work Portal - Deployment Verification', colors.bold);
  log('═══════════════════════════════════════════════', colors.bold);
  
  const backendOk = await checkBackend(backendUrl);
  const frontendOk = await checkFrontend(frontendUrl, backendUrl);
  
  if (backendOk) {
    await checkEndpoints(backendUrl);
  }
  
  await checkCORS(frontendUrl, backendUrl);
  
  log('\n═══════════════════════════════════════════════', colors.bold);
  
  if (backendOk && frontendOk) {
    success('Deployment looks good! ');
    info('Next steps:');
    console.log(`   1. Open ${frontendUrl} in browser`);
    console.log(`   2. Check DevTools Console for errors`);
    console.log(`   3. Try logging in as CEO`);
    console.log(`   4. Check dashboard loads correctly`);
  } else {
    error('Deployment has issues - fix the errors above');
    info('See DEPLOYMENT.md for detailed troubleshooting');
  }
  
  log('═══════════════════════════════════════════════\n', colors.bold);
}

main().catch(err => {
  error(`Fatal error: ${err.message}`);
  process.exit(1);
});
