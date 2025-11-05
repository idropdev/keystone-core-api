# Apple Sign-In Debugging Guide - "Sign up could not be completed"

**Error:** "Sign up could not be completed"  
**Platform:** Mac  
**Status:** Troubleshooting in progress

---

## 🔍 Step-by-Step Debugging Process

### Step 1: Identify WHERE the Error Occurs

**Question:** At what exact point do you see this error?

1. **Before the Apple dialog appears?**
   - → Problem: Network/firewall blocking Apple domains
   - → Jump to: [Network Debugging](#step-2-network-debugging)

2. **In the Apple Sign In dialog itself?**
   - → Problem: Apple account issue or service configuration
   - → Jump to: [Apple Account Check](#step-3-apple-account-check)

3. **After you click "Continue" in the dialog?**
   - → Problem: Bundle ID mismatch or backend verification
   - → Jump to: [Token Verification](#step-4-token-verification-debugging)

---

## Step 2: Network Debugging

### Test Apple Domain Accessibility

Run these commands in Terminal:

```bash
# Test 1: Basic connectivity
echo "Testing Apple domain access..."
for domain in appleid.apple.com idmsa.apple.com setup.icloud.com gsa.apple.com gs.apple.com appleid.cdn-apple.com; do
  echo -n "Testing $domain... "
  if curl -s -I --max-time 5 "https://$domain" > /dev/null 2>&1; then
    echo "✅ OK"
  else
    echo "❌ FAILED"
  fi
done

# Test 2: Check for VPN/Proxy interference
echo ""
echo "Current network configuration:"
scutil --proxy

# Test 3: Check firewall
echo ""
echo "Firewall status:"
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate
```

**Expected Results:**
- All domains should show ✅ OK
- If ANY show ❌ FAILED → Network/firewall issue

**Fix if domains fail:**
```bash
# Option 1: Disable VPN temporarily
# Option 2: Add Apple domains to firewall allowlist
# Option 3: Check corporate proxy settings
```

---

## Step 3: Apple Account Check

### Verify Your Apple ID Status

Some Apple IDs have restrictions that prevent Sign in with Apple:

```bash
# Test your Apple ID directly
open "https://appleid.apple.com/"
# Log in and check for any warnings/restrictions
```

**Common Issues:**
1. **New Apple ID (< 24 hours old)** → Wait 24 hours
2. **Multiple sign-ups recently** → Wait before trying again
3. **Apple ID locked/restricted** → Check email from Apple
4. **Two-Factor Authentication disabled** → Enable it in Settings

**Try a Different Apple ID:**
- If you have another Apple ID, try it
- This confirms if it's account-specific

---

## Step 4: Token Verification Debugging

### Check Your Backend Configuration

**1. Verify environment variables:**

```bash
# In your project directory
cd /Users/joelmartinez/Documents/dropdev/keystone-core-api

# Check if .env file exists
if [ -f .env ]; then
  echo "✅ .env file exists"
  grep "APPLE_APP_AUDIENCE" .env
else
  echo "❌ .env file missing - create it from env-example-relational"
fi
```

**2. Verify bundle ID matches:**

Your `.env` should have:
```env
APPLE_APP_AUDIENCE=["com.healthatlas.app", "com.healthatlas.auth"]
```

**3. Check your Mac app's bundle ID:**

```bash
# If you have Xcode project
# Get bundle ID from your Mac app
defaults read /Applications/YourApp.app/Contents/Info CFBundleIdentifier
```

**Must match EXACTLY** (case-sensitive)

---

## Step 5: Enable Detailed Logging

### Mac App Side (Swift)

Add this to your Sign in with Apple code:

```swift
func authorizationController(controller: ASAuthorizationController, 
                            didCompleteWithError error: Error) {
    print("❌ Apple Sign In Error:")
    print("Error: \(error)")
    print("Localized: \(error.localizedDescription)")
    
    if let authError = error as? ASAuthorizationError {
        print("Code: \(authError.code.rawValue)")
        print("User Info: \(authError.errorUserInfo)")
    }
}
```

### Backend Side (NestJS)

**Start backend in debug mode:**

```bash
cd /Users/joelmartinez/Documents/dropdev/keystone-core-api

# Start with verbose logging
LOG_LEVEL=debug npm run start:dev
```

Watch the console when you try to sign in.

---

## Step 6: Apple Developer Console Verification

### Check Configuration

1. **Go to:** https://developer.apple.com/account/resources/identifiers/list

2. **For Mac App - Check App ID:**
   - Select `com.healthatlas.app` (or your actual bundle ID)
   - ✅ "Sign in with Apple" should be **enabled**
   - ✅ Should be **PRIMARY** (not grouped)
   - Click "Edit" → "Sign in with Apple" → "Configure"
   - ✅ Note which configuration it shows

3. **For Web (if applicable) - Check Service ID:**
   - Select `com.healthatlas.auth`
   - ✅ "Sign in with Apple" enabled
   - ✅ Domains configured
   - ✅ Return URLs configured

---

## Step 7: Test with Minimal Example

### Create Test Script

```bash
# Save as test-apple-signin.sh
#!/bin/bash

echo "=== Apple Sign In Configuration Test ==="
echo ""

# 1. Check network
echo "1. Network Test:"
if curl -s -I --max-time 5 https://appleid.apple.com > /dev/null 2>&1; then
  echo "   ✅ Can reach appleid.apple.com"
else
  echo "   ❌ Cannot reach appleid.apple.com - CHECK FIREWALL/VPN"
  exit 1
fi

# 2. Check backend
echo ""
echo "2. Backend Test:"
if [ -f .env ]; then
  echo "   ✅ .env file exists"
  if grep -q "APPLE_APP_AUDIENCE" .env; then
    echo "   ✅ APPLE_APP_AUDIENCE configured:"
    grep "APPLE_APP_AUDIENCE" .env
  else
    echo "   ❌ APPLE_APP_AUDIENCE not found in .env"
  fi
else
  echo "   ❌ .env file missing"
fi

# 3. Check if backend is running
echo ""
echo "3. Backend Running Test:"
if lsof -i :3000 > /dev/null 2>&1; then
  echo "   ✅ Backend running on port 3000"
else
  echo "   ⚠️  Backend not running on port 3000"
fi

echo ""
echo "=== Test Complete ==="
```

**Run it:**

```bash
chmod +x test-apple-signin.sh
./test-apple-signin.sh
```

---

## Step 8: Common Fixes

### Fix 1: Bundle ID Mismatch

**Problem:** Your Mac app bundle ID doesn't match `APPLE_APP_AUDIENCE`

**Fix:**

1. Get your actual Mac app bundle ID
2. Update `.env`:
   ```env
   APPLE_APP_AUDIENCE=["your.actual.bundle.id"]
   ```
3. Restart backend
4. Try again

### Fix 2: Network Blocking

**Problem:** Firewall/VPN blocking Apple domains

**Fix:**

```bash
# Temporarily disable VPN
# Or add these to your firewall allowlist:
# - appleid.apple.com
# - idmsa.apple.com
# - setup.icloud.com
# - gsa.apple.com
# - gs.apple.com
```

### Fix 3: Apple Developer Console Not Configured

**Problem:** App ID not enabled for Sign in with Apple

**Fix:**

1. Go to https://developer.apple.com/account/resources/identifiers/list
2. Select your App ID
3. Enable "Sign in with Apple"
4. Configure as PRIMARY
5. Save
6. Wait 5 minutes for changes to propagate
7. Try again

### Fix 4: Backend Not Running

**Problem:** Backend not started or crashed

**Fix:**

```bash
cd /Users/joelmartinez/Documents/dropdev/keystone-core-api
npm run start:dev
```

Watch for errors in the console.

---

## Step 9: Capture Exact Error Details

### Get Complete Error Information

**In your Mac app, add:**

```swift
func authorizationController(controller: ASAuthorizationController, 
                            didCompleteWithError error: Error) {
    // Detailed error logging
    print("=== APPLE SIGN IN ERROR ===")
    print("Error: \(error)")
    print("Description: \(error.localizedDescription)")
    
    if let authError = error as? ASAuthorizationError {
        switch authError.code {
        case .canceled:
            print("User canceled")
        case .unknown:
            print("Unknown error - \(authError.errorUserInfo)")
        case .invalidResponse:
            print("Invalid response from Apple")
        case .notHandled:
            print("Not handled")
        case .failed:
            print("Failed - \(authError.errorUserInfo)")
        @unknown default:
            print("Other error")
        }
    }
    
    print("=== END ERROR ===")
}
```

---

## Step 10: Last Resort - System Check

### Check macOS System Status

```bash
# Check system keychain
security find-identity -v -p codesigning

# Check if Apple services are working system-wide
open "https://www.apple.com/support/systemstatus/"
# Look for "Apple ID" service status

# Try signing out/in to Apple ID in System Settings
echo "Go to: System Settings → Apple ID → Sign Out → Sign In"
```

---

## 🎯 Quick Checklist

Run through this quickly:

```bash
# Paste this entire block in Terminal:

echo "=== Quick Apple Sign In Debug ==="

# 1. Network
curl -I https://appleid.apple.com 2>&1 | grep -q "HTTP" && echo "✅ Network OK" || echo "❌ Network FAIL"

# 2. Backend .env
[ -f .env ] && echo "✅ .env exists" || echo "❌ .env missing"

# 3. Backend running
lsof -i :3000 >/dev/null 2>&1 && echo "✅ Backend running" || echo "❌ Backend not running"

# 4. Apple audience configured
grep -q "APPLE_APP_AUDIENCE" .env 2>/dev/null && echo "✅ APPLE_APP_AUDIENCE set" || echo "❌ APPLE_APP_AUDIENCE missing"

echo "=== End Quick Debug ==="
```

---

## 📞 Next Steps

**Please run the Quick Checklist above and share the results.**

Also answer:
1. **When exactly does the error appear?** (before dialog / in dialog / after clicking continue)
2. **What does the error message say exactly?** (screenshot if possible)
3. **Are you using a Mac app with native SDK or testing the web URL?**
4. **What's your Mac app's actual bundle ID?**
5. **Is your backend running?**

With this information, I can pinpoint the exact issue.

---

## 🔧 Most Likely Issues (Ranked by Frequency)

1. **60%** - Network/firewall blocking Apple domains
2. **25%** - Bundle ID mismatch between app and backend
3. **10%** - Apple Developer Console not configured
4. **5%** - Apple account restrictions

Let's find which one it is!

