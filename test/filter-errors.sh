#!/bin/bash
# Filter Jest test output to show only errors and failures

# Run tests and filter output
npm run test:e2e -- "$@" 2>&1 | \
  grep -E "(FAIL|PASS|●|✕|error|Error|ERROR|at |Expected|received|toBe|toHaveProperty|TypeError|ReferenceError|Cannot find|is not defined|is not a function)" | \
  grep -v "console.log" | \
  grep -v "query" | \
  grep -v "SELECT" | \
  grep -v "INSERT" | \
  grep -v "UPDATE" | \
  grep -v "DELETE" | \
  grep -v "FROM" | \
  grep -v "WHERE"






