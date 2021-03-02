"use strict";

// Public modules from npm
import cheerio from "cheerio";

// Modules from files
import Post from "./post";
import PlatformUser from "./platform-user";
import { TRating } from "../interfaces";
import { urls } from "../constants/url";
import { THREAD } from "../constants/css-selector";
import { fetchHTML, fetchPOSTResponse } from "../network-helper";
import Shared from "../shared";
import { GenericAxiosError, UnexpectedResponseContentType } from "./errors";
import { Result } from "./result";
import { getJSONLD, TJsonLD } from "../scrape-data/json-ld";

/**
 * Represents a generic F95Zone platform thread.
 */
export default class Thread {

    //#region Fields

    private _id: number;
    private _url: string;
    private _title: string;
    private _tags: string[];
    private _prefixes: string[];
    private _posts: Post[];
    private _rating: TRating;
    private _owner: PlatformUser;
    private _creation: Date;

    //#endregion Fields

    //#region Getters

    /**
     * Unique ID of the thread on the platform.
     */
    public get id() { return this._id; }
    /**
     * URL of the thread.
     * 
     * It may vary depending on any versions of the contained product.
     */
    public get url() { return this._url; }
    /**
     * Thread title.
     */
    public get title() { return this._title; };
    /**
     * Tags associated with the thread.
     */
    public get tags() { return this._tags; }
    /**
     * Prefixes associated with the thread
     */
    public get prefixes() { return this._prefixes; }
    /**
     * List of posts belonging to the thread.
     */
    public get posts() { return this._posts; }
    /**
     * Rating assigned to the thread.
     */
    public get rating() { return this._rating; }
    /**
     * Owner of the thread.
     */
    public get owner() { return this._owner; }
    /**
     * Creation date of the thread.
     */
    public get creation() { return this._creation; }

    //#endregion Getters

    /**
     * Initializes an object for mapping a thread. 
     * 
     * The unique ID of the thread must be specified.
     */
    constructor(id: number) { this._id = id; }

    //#region Private methods

    /**
     * Set the number of posts to display for the current thread.
     */
    private async setMaximumPostsForPage(n: 20 | 40 | 60 | 100): Promise<void> {
        // Prepare the parameters to send via POST request
        const params = {
            "_xfResponseType": "json",
            "_xfRequestUri": `/account/dpp-update?content_type=thread&content_id=${this.id}`,
            "_xfToken": Shared.session.token,
            "_xfWithData": "1",
            "content_id": this.id.toString(),
            "content_type": "thread",
            "dpp_custom_config[posts]": n.toString(),
        };

        // Send POST request
        const response = await fetchPOSTResponse(urls.F95_POSTS_NUMBER, params);
        if (response.isFailure()) throw response.value;
    }

    /**
     * Gets all posts on a page.
     */
    private async parsePostsInPage(html: string): Promise<Post[]> {
        // Load the HTML
        const $ = cheerio.load(html);

        // Start parsing the posts
        const postPromises = $(THREAD.POSTS_IN_PAGE)
            .toArray()
            .map(async (idx, el) => {
                // Parse post data
                const p = new Post();
                await p.fetchData($(el));

                return p;
            });

        // Wait for the post to be fetched
        return await Promise.all(postPromises);
    }

    /**
     * Gets all posts in the thread.
     */
    private async fetchPosts(pages: number): Promise<Post[]> {
        // Local variables
        type TFetchResult = Promise<Result<GenericAxiosError | UnexpectedResponseContentType, string>>;
        const htmlPromiseList: TFetchResult[] = [];
        const fetchedPosts: Post[] = [];

        // Set the maximum number of post to 100
        await this.setMaximumPostsForPage(100);

        // Fetch posts for every page in the thread
        for (let i = 1; i <= pages; i++) {
            // Prepare the URL
            const url = new URL(`page-${i}`, urls.F95_BASE_URL).toString();

            // Fetch the HTML source
            const htmlResponse = fetchHTML(url);
            htmlPromiseList.push(htmlResponse);
        }

        // Wait for all the pages to load
        const responses = await Promise.all(htmlPromiseList);

        // Scrape the pages
        for (const response of responses) {
            if (response.isSuccess()) {
                // Parse the posts
                const posts = await this.parsePostsInPage(response.value);

                fetchedPosts.push(...posts);
            } else throw response.value;
        }
        
        // Sorts the list of posts
        return fetchedPosts.sort((a, b) => (a.id > b.id) ? 1 : ((b.id > a.id) ? -1 : 0));
    }

    /**
     * It processes the rating of the thread 
     * starting from the data contained in the JSON+LD tag.
     */
    private parseRating(data: TJsonLD): TRating {
        const ratingTree = data["aggregateRating"] as TJsonLD;
        const rating: TRating = {
            average: parseFloat(ratingTree["ratingValue"] as string),
            best: parseInt(ratingTree["bestRating"] as string),
            count: parseInt(ratingTree["ratingCount"] as string),
        };

        return rating;
    }

    //#endregion Private methods

    //#region Public methods

    /**
     * Gets information about this thread.
     */
    public async fetch() {
        // Prepare the url
        this._url = new URL(this.id.toString(), urls.F95_BASE_URL).toString();

        // Fetch the HTML source
        const htmlResponse = await fetchHTML(this.url);

        if (htmlResponse.isSuccess()) {
            // Load the HTML
            const $ = cheerio.load(htmlResponse.value);

            // Fetch data from selectors
            const creationDatetime = $(THREAD.CREATION).attr("datetime");
            const ownerID = $(THREAD.OWNER_ID).attr("data-user-id");
            const tagArray = $(THREAD.TAGS).toArray();
            const prefixArray = $(THREAD.PREFIXES).toArray();
            const JSONLD = getJSONLD($("body"));

            // Parse the thread's data
            this._title = $(THREAD.TITLE).text();
            this._creation = new Date(creationDatetime);
            this._tags = tagArray.map(el => $(el).text().trim());
            this._prefixes = prefixArray.map(el => $(el).text().trim());
            this._owner = new PlatformUser(parseInt(ownerID));
            this._rating = this.parseRating(JSONLD);

            // Parse all the posts
            const pages = parseInt($(THREAD.LAST_PAGE).first().text());
            this._posts = await this.fetchPosts(pages);

        } else throw htmlResponse.value;
    }

    //#endregion Public methods

}