# Flutter Test App Development Prompt for Keystone Core API

## Project Overview

Create a **minimalist Flutter mobile application** to test all authentication endpoints of the Keystone Core API. The app should use **GetX** for state management and follow a clean, Apple-inspired minimalist design aesthetic.

---

## Technical Requirements

### Architecture & State Management

- **State Management:** GetX (Get package)
- **API Layer:** Use GetX Controllers for all API calls and data management
- **Design Pattern:** MVC with GetX  Controllers
- **Navigation:** GetX routing
- **Storage:** GetStorage for secure token storage

### UI/UX Requirements

- **Design Style:** Minimalist, Apple-inspired aesthetic
- **Theme:** Light mode with clean whites, subtle grays, iOS blue accents
- **Typography:** SF Pro (iOS) / Roboto (Android) - system defaults
- **Spacing:** Generous padding, clean layouts
- **Animations:** Smooth, subtle transitions using GetX
- **Feedback:** Loading states, success/error snackbars using GetX

---

## Backend API Specification

### Base URL

```dart
// Development
const String BASE_URL = 'http://localhost:3000/api';

// Production (configure via environment)
// const String BASE_URL = 'https://api.healthatlas.com/api';
```

### API Version

All endpoints are versioned under `/v1/`

---

## Required Endpoints Implementation

### 1. OAuth Authentication

#### Google Sign In
```dart
POST /v1/auth/google/login
Content-Type: application/json

Request:
{
  "idToken": "string" // From Google Sign-In SDK
}

Response: (200 OK)
{
  "token": "string",          // Access token (JWT, 15min expiry)
  "refreshToken": "string",   // Refresh token (long-lived)
  "tokenExpires": number,     // Unix timestamp
  "user": {
    "id": "string",
    "email": "string",
    "firstName": "string",
    "lastName": "string",
    "provider": "google",
    "role": {
      "id": number,
      "name": "string"
    },
    "status": {
      "id": number,
      "name": "string"
    }
  }
}
```

#### Apple Sign In
```dart
POST /v1/auth/apple/login
Content-Type: application/json

Request:
{
  "idToken": "string",        // From Sign in with Apple SDK
  "firstName": "string?",     // Optional, only on first sign-in
  "lastName": "string?"       // Optional, only on first sign-in
}

Response: (200 OK)
// Same structure as Google login response
```

### 2. Email/Password Authentication

#### Email Login
```dart
POST /v1/auth/email/login
Content-Type: application/json

Request:
{
  "email": "string",
  "password": "string"
}

Response: (200 OK)
// Same structure as OAuth login response
```

#### Email Registration
```dart
POST /v1/auth/email/register
Content-Type: application/json

Request:
{
  "email": "string",
  "password": "string",
  "firstName": "string",
  "lastName": "string"
}

Response: (204 No Content)
// User receives confirmation email
```

#### Confirm Email
```dart
POST /v1/auth/email/confirm
Content-Type: application/json

Request:
{
  "hash": "string" // From email confirmation link
}

Response: (204 No Content)
```

#### Forgot Password
```dart
POST /v1/auth/forgot/password
Content-Type: application/json

Request:
{
  "email": "string"
}

Response: (204 No Content)
// User receives password reset email
```

#### Reset Password
```dart
POST /v1/auth/reset/password
Content-Type: application/json

Request:
{
  "hash": "string",     // From password reset email
  "password": "string"  // New password
}

Response: (204 No Content)
```

### 3. Session Management

#### Get Current User
```dart
GET /v1/auth/me
Authorization: Bearer {accessToken}

Response: (200 OK)
{
  "id": "string",
  "email": "string",
  "firstName": "string",
  "lastName": "string",
  "provider": "google" | "apple" | "email",
  "role": {
    "id": number,
    "name": "string"
  },
  "status": {
    "id": number,
    "name": "string"
  },
  "createdAt": "string",
  "updatedAt": "string"
}
```

#### Refresh Token
```dart
POST /v1/auth/refresh
Authorization: Bearer {refreshToken}

Response: (200 OK)
{
  "token": "string",          // New access token
  "refreshToken": "string",   // New refresh token (rotated)
  "tokenExpires": number
}
```

#### Logout
```dart
POST /v1/auth/logout
Authorization: Bearer {accessToken}

Response: (204 No Content)
// Invalidates session immediately
```

### 4. Profile Management

#### Update Profile
```dart
PATCH /v1/auth/me
Authorization: Bearer {accessToken}
Content-Type: application/json

Request:
{
  "firstName": "string?",
  "lastName": "string?",
  "email": "string?",        // Requires email confirmation if changed
  "password": "string?",
  "oldPassword": "string?"   // Required if changing password
}

Response: (200 OK)
// Returns updated user object (same structure as GET /me)
```

#### Delete Account (Soft Delete)
```dart
DELETE /v1/auth/me
Authorization: Bearer {accessToken}

Response: (204 No Content)
// Soft-deletes account (HIPAA compliance - keeps for audit trail)
```

---

## GetX Controller Architecture

### Required Controllers

#### 1. AuthController
```dart
class AuthController extends GetxController {
  // Observables
  final Rx<User?> currentUser = Rx<User?>(null);
  final RxBool isAuthenticated = false.obs;
  final RxBool isLoading = false.obs;
  final RxString error = ''.obs;
  
  // Token management
  final RxString accessToken = ''.obs;
  final RxString refreshToken = ''.obs;
  final Rx<DateTime?> tokenExpiry = Rx<DateTime?>(null);
  
  // Methods to implement
  Future<void> googleSignIn();
  Future<void> appleSignIn();
  Future<void> emailLogin(String email, String password);
  Future<void> emailRegister(RegisterData data);
  Future<void> forgotPassword(String email);
  Future<void> resetPassword(String hash, String password);
  Future<void> logout();
  Future<void> refreshAccessToken();
  Future<void> loadCurrentUser();
  Future<void> updateProfile(UpdateProfileData data);
  Future<void> deleteAccount();
  
  // Token auto-refresh logic
  void startTokenRefreshTimer();
  void stopTokenRefreshTimer();
}
```

#### 2. ApiController
```dart
class ApiController extends GetxController {
  // HTTP client configuration
  final Dio dio = Dio();
  
  // Base configuration
  void setupInterceptors();
  void setAuthToken(String token);
  void clearAuthToken();
  
  // Generic API methods
  Future<Response> get(String path, {Map<String, dynamic>? params});
  Future<Response> post(String path, {dynamic data});
  Future<Response> patch(String path, {dynamic data});
  Future<Response> delete(String path);
  
  // Error handling
  void handleApiError(DioException error);
}
```

#### 3. StorageController
```dart
class StorageController extends GetxController {
  // Secure storage for tokens
  Future<void> saveTokens(String accessToken, String refreshToken, DateTime expiry);
  Future<Map<String, dynamic>?> loadTokens();
  Future<void> clearTokens();
  
  // User data caching
  Future<void> saveUser(User user);
  Future<User?> loadUser();
  Future<void> clearUser();
}
```

---

## Required Screens & Features

### 1. Welcome Screen (Initial Screen)

**UI Elements:**
- App logo/name at top
- Tagline/description
- **"Sign in with Google"** button (white with Google logo)
- **"Sign in with Apple"** button (black with Apple logo)
- **"Continue with Email"** button (ghost button)
- **"Create Account"** text button at bottom

**Actions:**
- Tap Google → Trigger Google Sign-In SDK → POST to `/v1/auth/google/login`
- Tap Apple → Trigger Apple Sign-In SDK → POST to `/v1/auth/apple/login`
- Tap Email → Navigate to Email Login Screen
- Tap Create Account → Navigate to Registration Screen

**State Management:**
- Show loading indicator during OAuth flow
- Display error snackbar if login fails
- Navigate to Home Screen on success
- Save tokens to secure storage

### 2. Email Login Screen

**UI Elements:**
- Back button
- "Sign In" title
- Email text field
- Password text field (obscured)
- "Forgot Password?" link
- **"Sign In"** button (primary)
- "Don't have an account? Sign Up" at bottom

**Actions:**
- Tap Sign In → Validate inputs → POST to `/v1/auth/email/login`
- Tap Forgot Password → Navigate to Forgot Password Screen
- Tap Sign Up → Navigate to Registration Screen

**Validation:**
- Email format validation
- Password minimum 6 characters
- Show inline errors

### 3. Registration Screen

**UI Elements:**
- Back button
- "Create Account" title
- First Name text field
- Last Name text field
- Email text field
- Password text field
- Confirm Password text field
- **"Create Account"** button (primary)
- "Already have an account? Sign In" at bottom

**Actions:**
- Tap Create Account → Validate inputs → POST to `/v1/auth/email/register`
- Show success message: "Check your email to confirm your account"
- Navigate back to Login Screen

**Validation:**
- All fields required
- Email format validation
- Password minimum 8 characters
- Passwords must match
- Show inline errors

### 4. Forgot Password Screen

**UI Elements:**
- Back button
- "Reset Password" title
- Instructions text: "Enter your email to receive a password reset link"
- Email text field
- **"Send Reset Link"** button (primary)

**Actions:**
- Tap Send → Validate email → POST to `/v1/auth/forgot/password`
- Show success message: "Check your email for reset instructions"
- Navigate back to Login Screen

### 5. Home Screen (After Authentication)

**UI Elements:**
- App bar with:
  - App name/logo
  - Profile icon button
- Welcome message: "Welcome, {firstName}!"
- User info card:
  - Full name
  - Email
  - Provider (Google/Apple/Email)
  - Account creation date
- **API Test Section** (expandable):
  - "Test GET /me" button
  - "Test Refresh Token" button
  - Show last response in formatted JSON
- **"Logout"** button (danger style)

**Actions:**
- Tap Profile Icon → Navigate to Profile Screen
- Tap Test GET /me → Call GET `/v1/auth/me` → Display response
- Tap Test Refresh → Call POST `/v1/auth/refresh` → Display response
- Tap Logout → Confirm dialog → POST to `/v1/auth/logout` → Clear tokens → Navigate to Welcome Screen

**Auto-Features:**
- On screen load: Call GET `/v1/auth/me` to verify session
- If session invalid (401): Clear tokens, navigate to Welcome Screen
- Start token refresh timer (refresh 5 min before expiry)

### 6. Profile Screen

**UI Elements:**
- Back button
- "Profile" title
- Editable fields:
  - First Name
  - Last Name
  - Email (show current, allow change)
- **"Update Profile"** button (primary)
- **Change Password** section (if provider is email):
  - Current Password field
  - New Password field
  - Confirm New Password field
  - **"Update Password"** button
- **"Delete Account"** button (danger, at bottom)

**Actions:**
- Tap Update Profile → PATCH to `/v1/auth/me`
- Tap Update Password → PATCH to `/v1/auth/me` with password fields
- Tap Delete Account → Confirm dialog → DELETE to `/v1/auth/me` → Logout

### 7. API Testing Screen (Developer Tools)

**UI Elements:**
- Tab bar with sections:
  - OAuth
  - Email Auth
  - Session
  - Profile
- Each section shows:
  - Endpoint name (e.g., "POST /v1/auth/google/login")
  - **"Test"** button
  - Request payload (editable JSON)
  - Response display (formatted JSON)
  - Status code and timing
  - Error display if failed

**Purpose:**
- Allow testing all endpoints manually
- See raw request/response data
- Debug authentication flow
- Verify token behavior

**Endpoints to Include:**
1. POST /v1/auth/google/login
2. POST /v1/auth/apple/login
3. POST /v1/auth/email/login
4. POST /v1/auth/email/register
5. POST /v1/auth/forgot/password
6. POST /v1/auth/reset/password
7. GET /v1/auth/me
8. POST /v1/auth/refresh
9. POST /v1/auth/logout
10. PATCH /v1/auth/me
11. DELETE /v1/auth/me

---

## State Management Implementation

### Token Lifecycle Management

```dart
// Pseudo-code for token management

class AuthController extends GetxController {
  Timer? _refreshTimer;
  
  @override
  void onInit() {
    super.onInit();
    // Try to load saved tokens on app start
    _loadSavedAuth();
  }
  
  Future<void> _loadSavedAuth() async {
    final tokens = await StorageController.to.loadTokens();
    if (tokens != null) {
      accessToken.value = tokens['accessToken'];
      refreshToken.value = tokens['refreshToken'];
      tokenExpiry.value = tokens['expiry'];
      
      // Check if token is still valid
      if (DateTime.now().isBefore(tokenExpiry.value!)) {
        isAuthenticated.value = true;
        await loadCurrentUser();
        startTokenRefreshTimer();
      } else {
        // Token expired, try to refresh
        await refreshAccessToken();
      }
    }
  }
  
  void startTokenRefreshTimer() {
    stopTokenRefreshTimer();
    
    // Refresh 5 minutes before expiry
    final refreshTime = tokenExpiry.value!.subtract(Duration(minutes: 5));
    final delay = refreshTime.difference(DateTime.now());
    
    if (delay.isNegative) {
      // Already expired or about to expire
      refreshAccessToken();
    } else {
      _refreshTimer = Timer(delay, () {
        refreshAccessToken();
      });
    }
  }
  
  void stopTokenRefreshTimer() {
    _refreshTimer?.cancel();
    _refreshTimer = null;
  }
  
  Future<void> refreshAccessToken() async {
    try {
      // Use refresh token to get new access token
      final response = await ApiController.to.post(
        '/v1/auth/refresh',
        headers: {'Authorization': 'Bearer ${refreshToken.value}'},
      );
      
      // Update tokens
      accessToken.value = response.data['token'];
      refreshToken.value = response.data['refreshToken'];
      tokenExpiry.value = DateTime.fromMillisecondsSinceEpoch(
        response.data['tokenExpires']
      );
      
      // Save to storage
      await StorageController.to.saveTokens(
        accessToken.value,
        refreshToken.value,
        tokenExpiry.value!,
      );
      
      // Restart timer
      startTokenRefreshTimer();
      
    } catch (e) {
      // Refresh failed, logout user
      await logout();
    }
  }
  
  Future<void> logout() async {
    try {
      // Call logout endpoint
      await ApiController.to.post('/v1/auth/logout');
    } catch (e) {
      // Continue with local logout even if API fails
    }
    
    // Clear local state
    currentUser.value = null;
    isAuthenticated.value = false;
    accessToken.value = '';
    refreshToken.value = '';
    tokenExpiry.value = null;
    stopTokenRefreshTimer();
    
    // Clear storage
    await StorageController.to.clearTokens();
    await StorageController.to.clearUser();
    
    // Navigate to welcome screen
    Get.offAllNamed('/welcome');
  }
}
```

### API Interceptor for Auto Token Injection

```dart
// Pseudo-code for Dio interceptor

class ApiController extends GetxController {
  void setupInterceptors() {
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          // Auto-inject access token
          final token = AuthController.to.accessToken.value;
          if (token.isNotEmpty && !options.path.contains('refresh')) {
            options.headers['Authorization'] = 'Bearer $token';
          }
          return handler.next(options);
        },
        onError: (error, handler) async {
          // Handle 401 Unauthorized
          if (error.response?.statusCode == 401) {
            // Try to refresh token
            try {
              await AuthController.to.refreshAccessToken();
              // Retry original request
              final response = await dio.request(
                error.requestOptions.path,
                options: Options(
                  method: error.requestOptions.method,
                  headers: error.requestOptions.headers,
                ),
                data: error.requestOptions.data,
              );
              return handler.resolve(response);
            } catch (e) {
              // Refresh failed, logout
              await AuthController.to.logout();
              return handler.reject(error);
            }
          }
          return handler.reject(error);
        },
      ),
    );
  }
}
```

---

## Required Packages

Add to `pubspec.yaml`:

```yaml
dependencies:
  flutter:
    sdk: flutter
  
  # State Management
  get: ^4.6.6
  get_storage: ^2.1.1
  
  # Networking
  dio: ^5.4.0
  
  # OAuth
  google_sign_in: ^6.1.6
  sign_in_with_apple: ^5.0.0
  
  # UI Components
  flutter_svg: ^2.0.9
  cached_network_image: ^3.3.0
  
  # Utilities
  intl: ^0.18.1
  json_annotation: ^4.8.1

dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^3.0.1
  build_runner: ^2.4.7
  json_serializable: ^6.7.1
```

---

## Configuration Files

### iOS Configuration (for OAuth)

**ios/Runner/Info.plist:**
```xml
<!-- Google Sign-In -->
<key>GIDClientID</key>
<string>YOUR_GOOGLE_CLIENT_ID</string>

<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>com.googleusercontent.apps.YOUR_REVERSED_CLIENT_ID</string>
    </array>
  </dict>
</array>

<!-- Apple Sign In -->
<!-- Add "Sign in with Apple" capability in Xcode -->
```

**ios/Runner/Runner.entitlements:**
```xml
<key>com.apple.developer.applesignin</key>
<array>
    <string>Default</string>
</array>
```

### Android Configuration

**android/app/build.gradle:**
```gradle
// Set minSdkVersion to at least 21
minSdkVersion 21
```

**android/app/src/main/AndroidManifest.xml:**
```xml
<!-- Internet permission -->
<uses-permission android:name="android.permission.INTERNET"/>
```

---

## Design Specifications

### Color Palette

```dart
// lib/config/app_colors.dart

class AppColors {
  // Primary Colors
  static const primary = Color(0xFF007AFF);      // iOS Blue
  static const primaryDark = Color(0xFF0051D5);
  
  // Background
  static const background = Color(0xFFFAFAFA);   // Off-white
  static const surface = Colors.white;
  
  // Text
  static const textPrimary = Color(0xFF000000);
  static const textSecondary = Color(0xFF8E8E93);
  static const textTertiary = Color(0xFFC7C7CC);
  
  // Status
  static const success = Color(0xFF34C759);
  static const error = Color(0xFFFF3B30);
  static const warning = Color(0xFFFF9500);
  
  // Borders
  static const border = Color(0xFFE5E5EA);
  
  // Buttons
  static const buttonGoogle = Colors.white;
  static const buttonApple = Colors.black;
  static const buttonPrimary = primary;
}
```

### Typography

```dart
// lib/config/app_text_styles.dart

class AppTextStyles {
  // Headers
  static const h1 = TextStyle(
    fontSize: 34,
    fontWeight: FontWeight.bold,
    letterSpacing: 0.37,
  );
  
  static const h2 = TextStyle(
    fontSize: 28,
    fontWeight: FontWeight.bold,
    letterSpacing: 0.36,
  );
  
  static const h3 = TextStyle(
    fontSize: 22,
    fontWeight: FontWeight.w600,
    letterSpacing: 0.35,
  );
  
  // Body
  static const body = TextStyle(
    fontSize: 17,
    fontWeight: FontWeight.w400,
    letterSpacing: -0.41,
  );
  
  static const bodyBold = TextStyle(
    fontSize: 17,
    fontWeight: FontWeight.w600,
    letterSpacing: -0.41,
  );
  
  // Captions
  static const caption = TextStyle(
    fontSize: 13,
    fontWeight: FontWeight.w400,
    letterSpacing: -0.08,
  );
  
  // Buttons
  static const button = TextStyle(
    fontSize: 17,
    fontWeight: FontWeight.w600,
    letterSpacing: -0.41,
  );
}
```

### Spacing

```dart
// lib/config/app_spacing.dart

class AppSpacing {
  static const xs = 4.0;
  static const sm = 8.0;
  static const md = 16.0;
  static const lg = 24.0;
  static const xl = 32.0;
  static const xxl = 48.0;
}
```

### Button Styles

```dart
// Minimalist button components

// Primary Button (iOS Blue, rounded)
ElevatedButton(
  style: ElevatedButton.styleFrom(
    backgroundColor: AppColors.primary,
    foregroundColor: Colors.white,
    padding: EdgeInsets.symmetric(vertical: 16),
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(12),
    ),
    elevation: 0,
  ),
  onPressed: () {},
  child: Text('Button Text'),
);

// Ghost Button (outline only)
OutlinedButton(
  style: OutlinedButton.styleFrom(
    foregroundColor: AppColors.textPrimary,
    side: BorderSide(color: AppColors.border),
    padding: EdgeInsets.symmetric(vertical: 16),
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(12),
    ),
  ),
  onPressed: () {},
  child: Text('Button Text'),
);

// Sign in with Google (white background, Google colors)
ElevatedButton.icon(
  style: ElevatedButton.styleFrom(
    backgroundColor: Colors.white,
    foregroundColor: Colors.black87,
    padding: EdgeInsets.symmetric(vertical: 16),
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(12),
      side: BorderSide(color: AppColors.border),
    ),
    elevation: 0,
  ),
  icon: Image.asset('assets/google_logo.png', height: 24),
  label: Text('Sign in with Google'),
  onPressed: () {},
);

// Sign in with Apple (black background, white text)
ElevatedButton.icon(
  style: ElevatedButton.styleFrom(
    backgroundColor: Colors.black,
    foregroundColor: Colors.white,
    padding: EdgeInsets.symmetric(vertical: 16),
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(12),
    ),
    elevation: 0,
  ),
  icon: Icon(Icons.apple, size: 24),
  label: Text('Sign in with Apple'),
  onPressed: () {},
);
```

---

## Error Handling Requirements

### Display Error Messages

Use GetX Snackbars for user-friendly error messages:

```dart
void showError(String message) {
  Get.snackbar(
    'Error',
    message,
    backgroundColor: AppColors.error,
    colorText: Colors.white,
    snackPosition: SnackPosition.TOP,
    duration: Duration(seconds: 3),
    icon: Icon(Icons.error_outline, color: Colors.white),
  );
}

void showSuccess(String message) {
  Get.snackbar(
    'Success',
    message,
    backgroundColor: AppColors.success,
    colorText: Colors.white,
    snackPosition: SnackPosition.TOP,
    duration: Duration(seconds: 2),
    icon: Icon(Icons.check_circle_outline, color: Colors.white),
  );
}
```

### API Error Mapping

```dart
// Map backend errors to user-friendly messages

Map<int, String> errorMessages = {
  400: 'Invalid request. Please check your input.',
  401: 'Your session has expired. Please sign in again.',
  403: 'You don\'t have permission to perform this action.',
  404: 'The requested resource was not found.',
  422: 'Validation failed. Please check your input.',
  429: 'Too many requests. Please try again later.',
  500: 'Server error. Please try again later.',
};

String getErrorMessage(DioException error) {
  if (error.response?.statusCode != null) {
    return errorMessages[error.response!.statusCode] ?? 
           'An unexpected error occurred.';
  }
  
  if (error.type == DioExceptionType.connectionTimeout ||
      error.type == DioExceptionType.receiveTimeout) {
    return 'Connection timeout. Please check your internet connection.';
  }
  
  return 'Network error. Please try again.';
}
```

---

## Testing Checklist

### Functional Tests to Verify

- [ ] Google Sign In flow completes successfully
- [ ] Apple Sign In flow completes successfully
- [ ] Email login with valid credentials works
- [ ] Email registration creates account and sends confirmation
- [ ] Forgot password sends reset email
- [ ] Reset password updates password successfully
- [ ] GET /me returns current user data
- [ ] Token refresh works automatically
- [ ] Token refresh works when manually triggered
- [ ] Logout invalidates session immediately
- [ ] Profile update saves changes
- [ ] Password change works (for email accounts)
- [ ] Account deletion soft-deletes account
- [ ] 401 errors trigger automatic token refresh
- [ ] 401 errors after refresh trigger logout
- [ ] App restores session on restart (if token valid)
- [ ] App clears session on restart (if token expired)
- [ ] Loading states display during API calls
- [ ] Error messages display on failures
- [ ] Success messages display on success
- [ ] Form validation works on all input fields
- [ ] Navigation flows work correctly
- [ ] Back button behavior is correct
- [ ] App handles no internet connection gracefully

---

## Additional Features to Implement

### 1. Developer Tools Panel

Add a floating action button (FAB) on the home screen that opens a drawer with:
- Current token info (expiry time, refresh status)
- Last 10 API calls (endpoint, status, timing)
- Clear tokens button
- Force token refresh button
- View stored data button

### 2. Biometric Authentication (Optional)

After successful OAuth login, offer to enable biometric authentication for faster subsequent logins:
- Use `local_auth` package
- Store tokens securely using biometrics
- Quick login with fingerprint/face

### 3. Dark Mode (Optional)

Implement dark mode theme that follows system settings.

---

## Project Structure

```
lib/
├── main.dart
├── config/
│   ├── app_colors.dart
│   ├── app_text_styles.dart
│   ├── app_spacing.dart
│   └── constants.dart
├── controllers/
│   ├── auth_controller.dart
│   ├── api_controller.dart
│   └── storage_controller.dart
├── models/
│   ├── user_model.dart
│   ├── login_response_model.dart
│   └── api_error_model.dart
├── screens/
│   ├── welcome_screen.dart
│   ├── email_login_screen.dart
│   ├── registration_screen.dart
│   ├── forgot_password_screen.dart
│   ├── home_screen.dart
│   ├── profile_screen.dart
│   └── api_testing_screen.dart
├── widgets/
│   ├── custom_button.dart
│   ├── custom_text_field.dart
│   ├── loading_indicator.dart
│   └── user_info_card.dart
├── services/
│   ├── google_auth_service.dart
│   └── apple_auth_service.dart
└── utils/
    ├── validators.dart
    └── error_handler.dart
```

---

## Success Criteria

The app is considered complete when:

1. ✅ All 13 authentication endpoints are implemented and testable
2. ✅ Google Sign-In works end-to-end
3. ✅ Apple Sign-In works end-to-end
4. ✅ Email authentication (login/register/reset) works
5. ✅ Session management (me/refresh/logout) works
6. ✅ Profile management (update/delete) works
7. ✅ Token auto-refresh works automatically
8. ✅ Error handling displays user-friendly messages
9. ✅ Loading states show during API calls
10. ✅ Tokens persist across app restarts
11. ✅ UI follows minimalist, Apple-inspired design
12. ✅ GetX controllers manage all state and API calls
13. ✅ No crashes or major bugs during normal use

---

## Notes for AI Implementation

- **Follow GetX patterns:** All state management through GetX observables
- **Clean code:** DRY principles, clear separation of concerns
- **Comments:** Add comments for complex logic, especially token management
- **Error handling:** Wrap all API calls in try-catch blocks
- **User feedback:** Always show loading/success/error states
- **Security:** Never log tokens or sensitive data
- **HIPAA awareness:** Remember this is a healthcare API - handle errors gracefully
- **Testing focus:** This is a TEST app - prioritize ease of testing over production polish

---

## Backend Configuration for Testing

Make sure your backend is running with:

```bash
cd /Users/joelmartinez/Documents/dropdev/keystone-core-api
npm run start:dev
```

Backend should be accessible at: `http://localhost:3000`

API endpoints are under: `http://localhost:3000/api/v1/auth/...`

---

## Final Deliverable

A complete, working Flutter application that:
- Looks clean and minimalist (Apple aesthetic)
- Uses GetX for all state management
- Can test every authentication endpoint
- Handles OAuth (Google + Apple) natively
- Manages tokens automatically
- Provides excellent developer experience for API testing
- Is ready to run immediately with no additional setup

**This app is for testing the Keystone Core API authentication system.**


