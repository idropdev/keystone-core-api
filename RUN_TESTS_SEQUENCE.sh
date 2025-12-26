#!/bin/bash

# Run tests in sequence: migrations -> onboarding -> documents
# This ensures proper test data setup before document tests

set -e  # Exit on error

echo "=========================================="
echo "Step 1: Running database migrations"
echo "=========================================="
npm run migration:run

echo ""
echo "=========================================="
echo "Step 2: Running manager onboarding tests"
echo "=========================================="
npm run test:e2e -- test/managers/manager-onboarding.e2e-spec.ts

echo ""
echo "=========================================="
echo "Step 3: Running document processing tests"
echo "=========================================="
npm run test:e2e -- test/document-processing/documents.e2e-spec.ts

echo ""
echo "=========================================="
echo "All tests completed!"
echo "=========================================="

