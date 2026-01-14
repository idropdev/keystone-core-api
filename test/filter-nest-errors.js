#!/usr/bin/env node
/**
 * Filter Jest test output to show only NestJS errors and test failures
 * Usage: npm run test:e2e -- test/managers/manager-onboarding.e2e-spec.ts 2>&1 | node test/filter-nest-errors.js
 */

const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

let inErrorBlock = false;
let errorBuffer = [];
let testSuite = '';
let testName = '';

// Patterns to exclude (verbose database queries, etc.)
const excludePatterns = [
  /^query:/i,
  /^SELECT/i,
  /^INSERT/i,
  /^UPDATE/i,
  /^DELETE/i,
  /^FROM/i,
  /^WHERE/i,
  /^console\.log/i,
  /^\[Nest\]/i, // Nest startup messages
  /^Nest application successfully started/i,
  /^Application is running on/i,
];

// Patterns to include (errors, failures, important info)
const includePatterns = [
  /FAIL/i,
  /PASS/i,
  /●/,
  /✕/,
  /error TS/i,
  /Error:/i,
  /ERROR/i,
  /TypeError/i,
  /ReferenceError/i,
  /Cannot find/i,
  /is not defined/i,
  /is not a function/i,
  /Expected/i,
  /received/i,
  /toBe/i,
  /toHaveProperty/i,
  /at /,
  /Test Suites:/i,
  /Tests:/i,
  /Snapshots:/i,
  /Time:/i,
];

function shouldInclude(line) {
  // Always exclude verbose patterns
  for (const pattern of excludePatterns) {
    if (pattern.test(line)) {
      return false;
    }
  }

  // Include if matches important patterns
  for (const pattern of includePatterns) {
    if (pattern.test(line)) {
      return true;
    }
  }

  // Include if we're in an error block (between ● and next test)
  if (inErrorBlock) {
    return true;
  }

  return false;
}

rl.on('line', (line) => {
  const trimmed = line.trim();

  // Detect test suite start
  if (trimmed.startsWith('FAIL') || trimmed.startsWith('PASS')) {
    testSuite = trimmed;
    console.log('\n' + trimmed);
    return;
  }

  // Detect test name (starts with ● or ✕)
  if (trimmed.startsWith('●') || trimmed.startsWith('✕')) {
    testName = trimmed;
    inErrorBlock = trimmed.startsWith('✕');
    if (inErrorBlock) {
      errorBuffer = [trimmed];
    } else {
      console.log(trimmed);
    }
    return;
  }

  // Detect end of test summary
  if (trimmed.startsWith('Test Suites:') || trimmed.startsWith('Tests:') || trimmed.startsWith('Snapshots:') || trimmed.startsWith('Time:')) {
    console.log(trimmed);
    return;
  }

  // Process line
  if (shouldInclude(trimmed)) {
    if (inErrorBlock) {
      errorBuffer.push(trimmed);
    } else {
      console.log(trimmed);
    }
  } else if (inErrorBlock) {
    // If we hit a non-error line while in error block, flush buffer
    if (errorBuffer.length > 0) {
      console.log('\n' + errorBuffer.join('\n'));
      errorBuffer = [];
    }
    inErrorBlock = false;
  }
});

rl.on('close', () => {
  // Flush any remaining error buffer
  if (errorBuffer.length > 0) {
    console.log('\n' + errorBuffer.join('\n'));
  }
});






