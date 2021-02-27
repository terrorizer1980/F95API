"use strict";

// Public modules from npm
import axios, { AxiosResponse } from "axios";
import cheerio from "cheerio";
import axiosCookieJarSupport from "axios-cookiejar-support";
import tough from "tough-cookie";

// Modules from file
import shared from "./shared.js";
import { urls as f95url } from "./constants/url.js";
import { selectors as f95selector } from "./constants/css-selector.js";
import LoginResult from "./classes/login-result.js";
import credentials from "./classes/credentials.js";
import { failure, Result, success } from "./classes/result.js";
import { GenericAxiosError, InvalidF95Token, UnexpectedResponseContentType } from "./classes/errors.js";

// Global variables
const userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) " + 
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0 Safari/605.1.15";
// @ts-ignore
axiosCookieJarSupport.default(axios);

const commonConfig = {
    headers: {
        "User-Agent": userAgent,
        "Connection": "keep-alive"
    },
    withCredentials: true,
    jar: new tough.CookieJar() // Used to store the token in the PC
};

/**
 * Gets the HTML code of a page.
 */
export async function fetchHTML(url: string): Promise<Result<GenericAxiosError | UnexpectedResponseContentType, string>> {
    // Fetch the response of the platform
    const response = await fetchGETResponse(url);

    if (response.isSuccess()) {
        const isHTML = response.value["content-type"].includes("text/html");

        const unexpectedResponseError = new UnexpectedResponseContentType({
            id: 2,
            message: `Expected HTML but received ${response.value["content-type"]}`,
            error: null
        });

        return isHTML ? 
            success(response.value.data as string) :
            failure(unexpectedResponseError);
    } else return failure(response.value as GenericAxiosError);
}

/**
 * It authenticates to the platform using the credentials 
 * and token obtained previously. Save cookies on your 
 * device after authentication.
 * @param {module:./classes/credentials.ts:Credentials} credentials Platform access credentials
 * @param {Boolean} force Specifies whether the request should be forced, ignoring any saved cookies
 * @returns {Promise<LoginResult>} Result of the operation
 */
export async function authenticate(credentials: credentials, force: boolean = false): Promise<LoginResult> {
    shared.logger.info(`Authenticating with user ${credentials.username}`);
    if (!credentials.token) throw new InvalidF95Token(`Invalid token for auth: ${credentials.token}`);

    // Secure the URL
    const secureURL = enforceHttpsUrl(f95url.F95_LOGIN_URL);

    // Prepare the parameters to send to the platform to authenticate
    const params = new URLSearchParams();
    params.append("login", credentials.username);
    params.append("url", "");
    params.append("password", credentials.password);
    params.append("password_confirm", "");
    params.append("additional_security", "");
    params.append("remember", "1");
    params.append("_xfRedirect", "https://f95zone.to/");
    params.append("website_code", "");
    params.append("_xfToken", credentials.token);

    try {
        // Try to log-in
        let config = Object.assign({}, commonConfig);
        if (force) delete config.jar;
        const response = await axios.post(secureURL, params, config);

        // Parse the response HTML
        const $ = cheerio.load(response.data);

        // Get the error message (if any) and remove the new line chars
        const errorMessage = $("body").find(f95selector.LOGIN_MESSAGE_ERROR).text().replace(/\n/g, "");

        // Return the result of the authentication
        const result = errorMessage.trim() === "";
        const message = errorMessage.trim() === "" ? "Authentication successful" : errorMessage;
        return new LoginResult(result, message);
    } catch (e) {
        shared.logger.error(`Error ${e.message} occurred while authenticating to ${secureURL}`);
        return new LoginResult(false, `Error ${e.message} while authenticating`);
    }
};

/**
 * Obtain the token used to authenticate the user to the platform.
 */
export async function getF95Token() {
    // Fetch the response of the platform
    const response = await fetchGETResponse(f95url.F95_LOGIN_URL);

    if (response.isSuccess()) {
        // The response is a HTML page, we need to find the <input> with name "_xfToken"
        const $ = cheerio.load(response.value.data as string);
        return $("body").find(f95selector.GET_REQUEST_TOKEN).attr("value");
    } else throw response.value;
}

//#region Utility methods
/**
 * Performs a GET request to a specific URL and returns the response.
 */
export async function fetchGETResponse(url: string): Promise<Result<GenericAxiosError, AxiosResponse<any>>>{
    // Secure the URL
    const secureURL = enforceHttpsUrl(url);

    try {
        // Fetch and return the response
        const response = await axios.get(secureURL, commonConfig);
        return success(response);
    } catch (e) {
        shared.logger.error(`Error ${e.message} occurred while trying to fetch ${secureURL}`);
        const genericError = new GenericAxiosError({
            id: 1,
            message:`Error ${e.message} occurred while trying to fetch ${secureURL}`,
            error: e
        });
        return failure(genericError);
    }
}

/**
 * Enforces the scheme of the URL is https and returns the new URL.
 * @returns {String} Secure URL or `null` if the argument is not a string
 */
export function enforceHttpsUrl(url: string): string {
    return isStringAValidURL(url) ? url.replace(/^(https?:)?\/\//, "https://") : null;
};

/**
 * Check if the url belongs to the domain of the F95 platform.
 */
export function isF95URL(url: string): boolean {
    return url.toString().startsWith(f95url.F95_BASE_URL);
};

/**
 * Checks if the string passed by parameter has a 
 * properly formatted and valid path to a URL (HTTP/HTTPS).
 * @param {String} url String to check for correctness
 * @returns {Boolean} true if the string is a valid URL, false otherwise
 */
export function isStringAValidURL(url: string): boolean {
    // Many thanks to Daveo at StackOverflow (https://preview.tinyurl.com/y2f2e2pc)
    const expression = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)/;
    const regex = new RegExp(expression);
    return url.match(regex).length > 0;
};

/**
 * Check if a particular URL is valid and reachable on the web.
 * @param {string} url URL to check
 * @param {boolean} [checkRedirect] 
 * If true, the function will consider redirects a violation and return false.
 * Default: false
 * @returns {Promise<Boolean>} true if the URL exists, false otherwise
 */
export async function urlExists(url: string, checkRedirect: boolean = false): Promise<boolean> {
    // Local variables
    let valid = false;

    if (isStringAValidURL(url)) {
        valid = await axiosUrlExists(url);

        if (valid && checkRedirect) {
            const redirectUrl = await getUrlRedirect(url);
            valid = redirectUrl === url;
        }
    }

    return valid;
}

/**
 * Check if the URL has a redirect to another page.
 * @param {String} url URL to check for redirect
 * @returns {Promise<String>} Redirect URL or the passed URL
 */
export async function getUrlRedirect(url: string): Promise<string> {
    const response = await axios.head(url);
    return response.config.url;
}
//#endregion Utility methods

//#region Private methods
/**
 * Check with Axios if a URL exists.
 */
async function axiosUrlExists(url: string): Promise<boolean> {
    // Local variables
    const ERROR_CODES = ["ENOTFOUND", "ETIMEDOUT"];
    let valid = false;

    try {
        const response = await axios.head(url, {
            timeout: 3000
        });
        valid = response && !/4\d\d/.test(response.status.toString());
    } catch (error) {
        // Throw error only if the error is unknown
        if (!ERROR_CODES.includes(error.code)) throw error;
    }

    return valid;
}
//#endregion