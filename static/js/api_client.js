/**
 * API Client - A centralized fetch wrapper for handling API requests and responses.
 * It automatically handles authentication errors (401) by redirecting the user to the login page.
 */
const apiClient = {
    async _request(url, options) {
        try {
            const response = await fetch(url, options);

            // The most important part: handle session expiration globally.
            if (response.status === 401) {
                // Clean up any stale tokens
                sessionStorage.removeItem('firebaseToken');

                // Inform the user and redirect them.
                await Swal.fire({
                    title: 'انتهت صلاحية الجلسة',
                    text: 'سيتم توجيهك إلى صفحة تسجيل الدخول الآن.',
                    icon: 'warning',
                    timer: 3000,
                    timerProgressBar: true,
                    allowOutsideClick: false,
                    allowEscapeKey: false,
                    showConfirmButton: false,
                });

                // Redirect to login page.
                window.location.href = '/auth/login';

                // Throw an error to stop the original promise chain.
                throw new Error("Session expired. Redirecting...");
            }

            const data = await response.json();

            if (!response.ok) {
                // For other errors (e.g., 400, 404, 500), throw the message from the server.
                throw new Error(data.message || 'An unknown server error occurred.');
            }

            return data;
        } catch (error) {
            // Re-throw the error so it can be caught by the calling function's .catch() block.
            console.error('API Client Error:', error.message);
            throw error;
        }
    },

    /**
     * Performs a GET request.
     * @param {string} url - The URL to fetch.
     * @returns {Promise<any>} - The JSON response from the server.
     */
    async get(url) {
        return this._request(url, { method: 'GET' });
    },

    /**
     * Performs a POST request.
     * @param {string} url - The URL to post to.
     * @param {FormData|URLSearchParams|object} body - The request body. If it's a plain object, it will be stringified as JSON.
     * @returns {Promise<any>} - The JSON response from the server.
     */
    async post(url, body) {
        const options = { method: 'POST' };

        if (body instanceof FormData || body instanceof URLSearchParams) {
            options.body = body;
        } else if (typeof body === 'object' && body !== null) {
            options.headers = { 'Content-Type': 'application/json' };
            options.body = JSON.stringify(body);
        }

        return this._request(url, options);
    }
};