#!/usr/bin/env node

/**
 * Run test sequence with logging
 * Captures all output to test-results.log while displaying in terminal
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const logFile = path.join(process.cwd(), 'test-results.log');
const timestamp = new Date().toISOString();

// Clear previous log and add header
const header = `\n${'='.repeat(80)}\nTest Sequence Started: ${timestamp}\n${'='.repeat(80)}\n\n`;
fs.writeFileSync(logFile, header, 'utf8');

function log(message) {
  const output = `${message}\n`;
  process.stdout.write(output);
  fs.appendFileSync(logFile, output, 'utf8');
}

function runCommand(command, args = [], description) {
  return new Promise((resolve, reject) => {
    log(`\n${'='.repeat(80)}`);
    log(`Running: ${description || command}`);
    log(`${'='.repeat(80)}\n`);

    const child = spawn(command, args, {
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: true,
      cwd: process.cwd(),
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;
      process.stdout.write(output);
      fs.appendFileSync(logFile, output, 'utf8');
    });

    child.stderr.on('data', (data) => {
      const output = data.toString();
      stderr += output;
      process.stderr.write(output);
      fs.appendFileSync(logFile, output, 'utf8');
    });

    child.on('close', (code) => {
      if (code !== 0) {
        log(`\n❌ Command failed with exit code ${code}`);
        reject(new Error(`Command failed: ${command} ${args.join(' ')}`));
      } else {
        log(`\n✅ Command completed successfully`);
        resolve();
      }
    });

    child.on('error', (error) => {
      log(`\n❌ Error running command: ${error.message}`);
      reject(error);
    });
  });
}

async function main() {
  try {
    log('Starting test sequence with logging...');
    log(`Log file: ${logFile}\n`);

    // Step 1: Run migrations
    await runCommand('npm', ['run', 'migration:run'], 'Database Migrations');

    // Step 2: Manager onboarding tests
    await runCommand('npm', ['run', 'test:e2e', '--', 'test/managers/manager-onboarding.e2e-spec.ts'], 'Manager Onboarding Tests');

    // Wait 5 minutes
    await runCommand('npm', ['run', 'wait:5min'], 'Waiting 5 minutes (rate limit reset)');

    // Step 3: Document processing tests
    await runCommand('npm', ['run', 'test:e2e', '--', 'test/document-processing/documents.e2e-spec.ts'], 'Document Processing Tests');

    // Wait 5 minutes
    await runCommand('npm', ['run', 'wait:5min'], 'Waiting 5 minutes (rate limit reset)');

    // Step 4: Access grants tests
    await runCommand('npm', ['run', 'test:e2e', '--', 'test/access-control/access-grants.e2e-spec.ts'], 'Access Grants Tests');

    const footer = `\n${'='.repeat(80)}\nTest Sequence Completed: ${new Date().toISOString()}\n${'='.repeat(80)}\n`;
    log(footer);
    fs.appendFileSync(logFile, footer, 'utf8');

    log(`\n✅ All tests completed successfully!`);
    log(`📄 Full log saved to: ${logFile}\n`);

    process.exit(0);
  } catch (error) {
    const errorMsg = `\n❌ Test sequence failed: ${error.message}\n`;
    log(errorMsg);
    fs.appendFileSync(logFile, errorMsg, 'utf8');
    process.exit(1);
  }
}

main();

