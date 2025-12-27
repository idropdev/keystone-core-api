#!/usr/bin/env node

/**
 * Wait script with countdown timer
 * Usage: node scripts/wait.js [minutes]
 * Default: 5 minutes
 */

const minutes = parseInt(process.argv[2]) || 5;
const totalMs = minutes * 60 * 1000;
const start = Date.now();

console.log(`⏳ Waiting ${minutes} minutes for rate limits to reset...`);
console.log('   (This allows rate limits to reset and prevents test failures)');

const interval = setInterval(() => {
  const elapsed = Date.now() - start;
  const remaining = Math.max(0, totalMs - elapsed);
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  
  process.stdout.write(`\r   Time remaining: ${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`);
  
  if (remaining <= 0) {
    clearInterval(interval);
    console.log('\n   ✅ Ready to continue!');
    process.exit(0);
  }
}, 1000);


