/**
 * Alpha Squared - Simple Authentication & Session Manager
 */

const AUTH_KEY = "alpha_squared_session";

function checkAuthSession() {
    const session = localStorage.getItem(AUTH_KEY);
    return session ? JSON.parse(session) : null;
}

function loginUser(email, role = "Caregiver") {
    const sessionData = {
        email: email || "caregiver@alphasquared.org",
        role: role,
        loginTime: new Date().toISOString()
    };
    localStorage.setItem(AUTH_KEY, JSON.stringify(sessionData));
    return sessionData;
}

function logoutUser() {
    localStorage.removeItem(AUTH_KEY);
    window.location.href = "index.html";
}
