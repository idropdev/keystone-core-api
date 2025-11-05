#!/bin/bash

# Apple Sign-In Diagnostic Script
# Run this to identify why "Sign up could not be completed" is happening

echo "════════════════════════════════════════════════════════════════"
echo "   Apple Sign-In Diagnostic Tool"
echo "   Checking common failure points..."
echo "════════════════════════════════════════════════════════════════"
echo ""

ERRORS=0
WARNINGS=0

# Test 1: Network Access to Apple Domains
echo "📡 TEST 1: Network Access to Apple Domains"
echo "────────────────────────────────────────────────────────────────"

APPLE_DOMAINS=(
    "appleid.apple.com"
    "idmsa.apple.com"
    "setup.icloud.com"
    "gsa.apple.com"
    "gs.apple.com"
    "appleid.cdn-apple.com"
)

for domain in "${APPLE_DOMAINS[@]}"; do
    echo -n "   Testing $domain... "
    if timeout 5 curl -s -I "https://$domain" > /dev/null 2>&1; then
        echo "✅ OK"
    else
        echo "❌ FAILED"
        ERRORS=$((ERRORS + 1))
    fi
done

if [ $ERRORS -gt 0 ]; then
    echo ""
    echo "   ⚠️  CRITICAL: Apple domains are blocked!"
    echo "   → Check your firewall settings"
    echo "   → Disable VPN temporarily"
    echo "   → Check corporate proxy settings"
fi
echo ""

# Test 2: Environment Configuration
echo "⚙️  TEST 2: Backend Configuration"
echo "────────────────────────────────────────────────────────────────"

if [ -f .env ]; then
    echo "   ✅ .env file exists"
    
    if grep -q "APPLE_APP_AUDIENCE" .env; then
        AUDIENCE=$(grep "APPLE_APP_AUDIENCE" .env | cut -d= -f2)
        echo "   ✅ APPLE_APP_AUDIENCE configured:"
        echo "      $AUDIENCE"
    else
        echo "   ❌ APPLE_APP_AUDIENCE not found"
        echo "   → Copy from env-example-relational"
        ERRORS=$((ERRORS + 1))
    fi
    
    if grep -q "GOOGLE_CLIENT_ID" .env; then
        echo "   ✅ OAuth configuration present"
    else
        echo "   ⚠️  OAuth config may be incomplete"
        WARNINGS=$((WARNINGS + 1))
    fi
else
    echo "   ❌ .env file NOT FOUND"
    echo "   → Create .env from env-example-relational"
    ERRORS=$((ERRORS + 1))
fi
echo ""

# Test 3: Backend Service Status
echo "🚀 TEST 3: Backend Service Status"
echo "────────────────────────────────────────────────────────────────"

if lsof -i :3000 > /dev/null 2>&1; then
    echo "   ✅ Backend is running on port 3000"
    
    # Try to hit the endpoint
    if curl -s http://localhost:3000/api/v1/auth/apple/login \
        -H "Content-Type: application/json" \
        -d '{"idToken":"test"}' 2>&1 | grep -q "Unauthorized\|Bad Request\|error"; then
        echo "   ✅ Apple login endpoint is responding"
    else
        echo "   ⚠️  Apple login endpoint may not be configured"
        WARNINGS=$((WARNINGS + 1))
    fi
else
    echo "   ❌ Backend is NOT running"
    echo "   → Run: npm run start:dev"
    ERRORS=$((ERRORS + 1))
fi
echo ""

# Test 4: System Status
echo "🖥️  TEST 4: System Status"
echo "────────────────────────────────────────────────────────────────"

# Check VPN
if scutil --nwi | grep -q "utun"; then
    echo "   ⚠️  VPN detected (may interfere with Apple Sign-In)"
    echo "   → Try disabling VPN temporarily"
    WARNINGS=$((WARNINGS + 1))
else
    echo "   ✅ No VPN detected"
fi

# Check internet connection
if ping -c 1 8.8.8.8 > /dev/null 2>&1; then
    echo "   ✅ Internet connection active"
else
    echo "   ❌ No internet connection"
    ERRORS=$((ERRORS + 1))
fi

# Check firewall
FIREWALL_STATUS=$(sudo /usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate 2>/dev/null | grep -o "enabled\|disabled" || echo "unknown")
echo "   ℹ️  Firewall status: $FIREWALL_STATUS"

echo ""

# Test 5: Apple Developer Configuration Check
echo "🍎 TEST 5: Apple Developer Configuration"
echo "────────────────────────────────────────────────────────────────"
echo "   ⚠️  Manual check required:"
echo ""
echo "   1. Go to: https://developer.apple.com/account/resources/identifiers/list"
echo "   2. Select your App ID (e.g., com.healthatlas.app)"
echo "   3. Verify 'Sign in with Apple' is ENABLED"
echo "   4. Click 'Configure' and verify it's set as PRIMARY"
echo ""

# Summary
echo "════════════════════════════════════════════════════════════════"
echo "   DIAGNOSTIC SUMMARY"
echo "════════════════════════════════════════════════════════════════"
echo ""

if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo "   ✅ All tests passed!"
    echo "   → Your configuration looks good"
    echo "   → The issue may be with:"
    echo "     • Apple account restrictions"
    echo "     • Bundle ID mismatch (check your Mac app)"
    echo "     • Apple Developer Console configuration"
    echo ""
elif [ $ERRORS -gt 0 ]; then
    echo "   ❌ Found $ERRORS critical issue(s)"
    echo "   → Fix the issues marked with ❌ above"
    echo "   → This is likely preventing Sign in with Apple from working"
    echo ""
else
    echo "   ⚠️  Found $WARNINGS warning(s)"
    echo "   → Your configuration may work but needs attention"
    echo ""
fi

# Next steps
echo "════════════════════════════════════════════════════════════════"
echo "   NEXT STEPS"
echo "════════════════════════════════════════════════════════════════"
echo ""
echo "   1. Fix any ❌ CRITICAL issues above"
echo "   2. Review ⚠️  WARNINGS"
echo "   3. Verify Apple Developer Console configuration"
echo "   4. Check your Mac app's Bundle ID matches APPLE_APP_AUDIENCE"
echo ""
echo "   For detailed debugging, see: APPLE_SIGNIN_DEBUG_GUIDE.md"
echo ""

# Offer to check bundle ID
echo "════════════════════════════════════════════════════════════════"
echo ""
read -p "Do you know your Mac app's Bundle ID? (y/n): " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    read -p "Enter your Bundle ID (e.g., com.healthatlas.app): " BUNDLE_ID
    echo ""
    
    if [ -f .env ]; then
        if grep "APPLE_APP_AUDIENCE" .env | grep -q "$BUNDLE_ID"; then
            echo "   ✅ Bundle ID '$BUNDLE_ID' is in APPLE_APP_AUDIENCE"
        else
            echo "   ❌ Bundle ID '$BUNDLE_ID' is NOT in APPLE_APP_AUDIENCE"
            echo "   → Update .env with:"
            echo "      APPLE_APP_AUDIENCE=[\"$BUNDLE_ID\"]"
        fi
    fi
    echo ""
fi

echo "════════════════════════════════════════════════════════════════"
echo "   Diagnostic Complete"
echo "════════════════════════════════════════════════════════════════"

