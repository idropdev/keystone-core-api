# Apple Sign-In Quick Reference Guide

## 🚀 Quick Start: Fix "Sign up could not be completed"

### Step 1: Test Network Access (Most Common Issue)

Run these commands on your Mac:
```bash
curl -I https://appleid.apple.com
curl -I https://idmsa.apple.com
curl -I https://setup.icloud.com
curl -I https://gsa.apple.com
curl -I https://gs.apple.com
```

**✅ Expected:** Each returns HTTP 200 or redirect  
**❌ Problem:** Timeout or connection refused → Your network is blocking Apple

**Fix:** Whitelist these domains in your firewall/VPN settings.

---

### Step 2: Verify Bundle ID Configuration

**Backend (in your `.env` file):**
```env
APPLE_APP_AUDIENCE=["com.healthatlas.app", "com.healthatlas.auth"]
```

**Mac App (Xcode):**
- Go to Project Settings → Signing & Capabilities
- Check "Bundle Identifier" matches one in `APPLE_APP_AUDIENCE`
- Must be **exact match** (case-sensitive)

**Decode Token to Verify:**
```bash
# Get ID token from your Mac app, then:
echo "PASTE_TOKEN_HERE" | cut -d. -f2 | base64 -D | jq .
# Look for "aud" field - must match APPLE_APP_AUDIENCE
```

---

### Step 3: Apple Developer Console Checklist

Go to: https://developer.apple.com/account/resources/identifiers/list

1. Select your App ID (e.g., `com.healthatlas.app`)
2. ✅ "Sign in with Apple" is **enabled**
3. ✅ Configure as **"Primary App ID"** (not grouped)
4. ✅ Bundle ID matches your Mac app exactly
5. Click "Save"

---

## 🔔 New Feature: Server-to-Server Notifications

### What It Does

Apple notifies your backend when users:
- Change email settings (Hide My Email)
- **Revoke consent** → All sessions immediately invalidated ✅
- **Delete Apple account** → Account soft-deleted, sessions invalidated ✅

### Configuration (5 Minutes)

1. **In Apple Developer Console:**
   - Select your App ID → "Sign in with Apple" → Configure
   - Find "Server-to-Server Notification Endpoint"
   - Enter: `https://your-domain.com/api/v1/auth/apple/notifications`
   - Requirements: HTTPS, TLS 1.2+, publicly accessible
   - Click "Save"

2. **Backend (Already Implemented):**
   - Endpoint: ✅ Created
   - HIPAA Compliance: ✅ All events logged
   - Session Invalidation: ✅ Immediate on consent revoked
   - Soft Delete: ✅ Audit trail preserved

3. **Test:**
   ```bash
   # From your production server (should return 400, not 404)
   curl https://your-domain.com/api/v1/auth/apple/notifications
   ```

---

## 📋 Complete Endpoint List

| Endpoint | Method | Purpose | Auth Required |
|----------|--------|---------|---------------|
| `/v1/auth/apple/login` | POST | User login with ID token | No |
| `/v1/auth/apple/notifications` | POST | Apple server notifications | No (Apple caller) |

---

## 🔍 Troubleshooting Decision Tree

```
❌ "Sign up could not be completed"
├─ Network/Firewall issue? (60% of cases)
│  └─ Test: curl -I https://appleid.apple.com
│     ├─ Timeout → Whitelist Apple domains
│     └─ Success → Continue to next
│
├─ Bundle ID mismatch? (30% of cases)
│  └─ Test: Decode token, check "aud" field
│     ├─ Mismatch → Update APPLE_APP_AUDIENCE
│     └─ Match → Continue to next
│
└─ Apple Developer Config? (10% of cases)
   └─ Check: App ID enabled as Primary
      ├─ Not enabled → Enable + Configure
      └─ Enabled → Check Apple System Status
```

---

## 🛡️ HIPAA Compliance Summary

✅ **No PHI in OAuth** - Only identity information  
✅ **No PHI in JWT** - Only user ID, role, session ID  
✅ **No PHI in Logs** - Only event types and user IDs  
✅ **Immediate Session Invalidation** - On consent revocation  
✅ **Soft Delete Only** - Maintains 6+ year audit trail  
✅ **All Events Logged** - Complete audit trail  
✅ **JWS Signature Verified** - Authenticity guaranteed  

---

## 📞 Quick Reference: Environment Variables

```env
# Required for Apple Sign-In
APPLE_APP_AUDIENCE=["com.healthatlas.app", "com.healthatlas.auth"]

# Backend must be accessible at (for notifications):
# https://your-domain.com/api/v1/auth/apple/notifications
```

---

## 🔗 Important URLs

- **Apple Developer Console:** https://developer.apple.com/account/resources/identifiers/list
- **System Status:** https://www.apple.com/support/systemstatus/
- **Full Documentation:** `docs/hipaa-authentication.md`
- **Implementation Details:** `APPLE_NOTIFICATIONS_IMPLEMENTATION.md`

---

## ⚡ Quick Commands Reference

```bash
# Test Apple domain access
for domain in appleid.apple.com idmsa.apple.com setup.icloud.com gsa.apple.com gs.apple.com; do
  echo "Testing $domain..."
  curl -I https://$domain -m 5
done

# Decode Apple ID token (check aud field)
echo "PASTE_TOKEN" | cut -d. -f2 | base64 -D | jq .

# Test login endpoint
curl -X POST http://localhost:3000/api/v1/auth/apple/login \
  -H "Content-Type: application/json" \
  -d '{"idToken": "YOUR_TOKEN"}'

# Test notifications endpoint (production)
curl https://your-domain.com/api/v1/auth/apple/notifications
```

---

## ✅ Production Deployment Checklist

Before going live:

- [ ] All Apple domains accessible (test with curl)
- [ ] APPLE_APP_AUDIENCE matches Mac app bundle ID
- [ ] Apple Developer Console configured (Primary App ID)
- [ ] Backend deployed with HTTPS (TLS 1.2+)
- [ ] Notification endpoint URL configured in Apple Console
- [ ] Notification endpoint publicly accessible
- [ ] Test login flow end-to-end
- [ ] Verify audit logs are working
- [ ] Test session invalidation on consent revocation

---

**Need Help?** Check `docs/hipaa-authentication.md` for detailed flows and troubleshooting.

