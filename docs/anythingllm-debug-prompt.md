# Prompt for Debugging AnythingLLM Service Identity Token Verification

Use this prompt with the AnythingLLM codebase to diagnose why service identity tokens are being rejected.

---

## Debugging Prompt

I'm debugging service identity token verification in AnythingLLM. Keystone Core API is sending valid GCP ID tokens, but AnythingLLM is returning 401 with "Invalid service identity token".

**Token being received:**
- Algorithm: RS256
- Audience (aud): `anythingllm-internal`
- Service Account Email: `keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com`
- Issuer (iss): `https://accounts.google.com`
- Key ID (kid): `496d008e8c7be1cae4209e0d5c21b050a61e960f`
- Full token payload: `{"aud":"anythingllm-internal","azp":"keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com","email":"keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com","email_verified":true,"exp":1766904756,"iat":1766901156,"iss":"https://accounts.google.com","sub":"101020433972434855339"}`

**Configuration expected:**
- `ANYTHINGLLM_SERVICE_AUDIENCE` should be `anythingllm-internal`
- Service account email should match: `keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com`

**Questions to answer:**

1. Where is the service identity token verification code located? Show me the file and function that validates tokens.

2. How is the token extracted from the Authorization header? Show the code that parses `Authorization: Bearer <token>`.

3. What is the value of `ANYTHINGLLM_SERVICE_AUDIENCE` environment variable being used? Is it exactly `anythingllm-internal` (no extra spaces, case-sensitive)?

4. What service account email is configured and how is it compared to the token's `email` claim? Show the comparison code.

5. How is the token signature verified? What library is used? Show the signature verification code.

6. Is the JWKS endpoint (`https://www.googleapis.com/oauth2/v3/certs`) being fetched correctly? Show any JWKS fetching code.

7. What validation checks are performed on the token? Show the complete validation flow:
   - Audience (aud) claim check
   - Service account email check
   - Issuer (iss) claim check
   - Expiration (exp) check
   - Signature verification

8. What error messages or logs are generated when token verification fails? Show any error logging code.

9. Is there any token caching that might interfere? Show caching logic if present.

10. Add detailed logging to the verification code to show:
    - The received token (decoded header and payload)
    - Configuration values being used
    - Each validation step result (pass/fail)
    - Exact error from JWT verification library if signature verification fails

**Expected verification steps:**
1. Extract token from `Authorization: Bearer <token>` header
2. Decode token header and payload
3. Verify `iss` === `https://accounts.google.com`
4. Verify `aud` === `ANYTHINGLLM_SERVICE_AUDIENCE` (exact match: `anythingllm-internal`)
5. Verify `email` === configured service account email (exact match)
6. Verify `exp` > current time (with clock skew tolerance)
7. Fetch JWKS from `https://www.googleapis.com/oauth2/v3/certs`
8. Find key with matching `kid` from token header
9. Verify signature using RS256 algorithm and public key from JWKS

**Most likely issues:**
- Audience mismatch (most common) - check environment variable
- Service account email mismatch
- JWKS fetch failure
- Signature verification failure
- Incorrect JWT library usage

Please analyze the codebase and identify where the verification is failing.

