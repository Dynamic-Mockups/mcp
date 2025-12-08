/**
 * Response Formatter for Dynamic Mockups MCP Server
 * Provides consistent MCP-compliant response formatting
 */

export class ResponseFormatter {
  /**
   * Create a successful MCP response with data
   * @param {any} data - Data to include in response
   * @returns {object} MCP-compliant response
   */
  static ok(data) {
    const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
    return {
      content: [{ type: "text", text }],
    };
  }

  /**
   * Create an error MCP response
   * @param {string} message - Error message
   * @param {object} details - Additional error details
   * @returns {object} MCP-compliant error response
   */
  static error(message, details = {}) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: { message, ...details } }, null, 2),
        },
      ],
      isError: true,
    };
  }

  /**
   * Format an API response, handling both success and error cases
   * @param {object} response - Axios response object
   * @param {string} successMessage - Optional success message prefix
   * @returns {object} MCP-compliant response
   */
  static fromApiResponse(response, successMessage = null) {
    const { status, data } = response;

    // Handle API errors (4xx responses)
    if (status >= 400) {
      const errorMessage = data?.message || data?.error || `API error (${status})`;
      return this.error(errorMessage, {
        status,
        details: data,
      });
    }

    // Handle successful responses
    if (successMessage) {
      return this.ok({
        message: successMessage,
        ...data,
      });
    }

    return this.ok(data);
  }

  /**
   * Format an error from a caught exception
   * @param {Error} error - The caught error
   * @param {string} context - Context description for the error
   * @returns {object} MCP-compliant error response
   */
  static fromError(error, context = "Operation failed") {
    // Handle Axios errors
    if (error.response) {
      return this.error(context, {
        status: error.response.status,
        message: error.response.data?.message || error.message,
        details: error.response.data,
      });
    }

    // Handle network errors
    if (error.code === "ECONNABORTED") {
      return this.error("Request timeout", {
        context,
        suggestion: "The API request took too long. Try again or use smaller batch sizes.",
      });
    }

    if (error.code === "ENOTFOUND" || error.code === "ECONNREFUSED") {
      return this.error("Network error", {
        context,
        suggestion: "Unable to reach the API. Check your internet connection.",
      });
    }

    // Handle generic errors
    return this.error(context, {
      message: error.message,
    });
  }
}

export default ResponseFormatter;
