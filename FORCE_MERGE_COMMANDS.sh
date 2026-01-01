#!/bin/bash
# Force merge script - accepts feature branch version (--ours) for all conflicts

cd /Users/joelmartinez/Documents/dropdev/keystone-core-api

echo "Force resolving merge conflicts by accepting feature branch changes (--ours)..."

# Accept our version for all conflicted files
git checkout --ours .gitignore
git checkout --ours src/document-processing/document-processing.controller.ts
git checkout --ours src/document-processing/document-processing.service.ts
git checkout --ours src/document-processing/domain/services/document-processing.domain.service.ts
git checkout --ours src/document-processing/infrastructure/storage/gcp-storage.adapter.ts

# Stage all resolved files
git add -A

# Complete the merge
git commit --no-edit

echo "Merge completed! You can now fix any issues and push."
echo "To push: git push origin feature/anythingllm-endpoint-integration"

