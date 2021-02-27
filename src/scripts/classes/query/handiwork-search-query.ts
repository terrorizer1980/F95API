"use strict";

// Public modules from npm
import validator from 'class-validator';

// Module from files
import { IQuery, TCategory, TQueryInterface } from "../../interfaces";
import LatestSearchQuery, { TLatestOrder } from './latest-search-query';
import ThreadSearchQuery, { TThreadOrder } from './thread-search-query';

// Type definitions
/**
 * Method of sorting results. Try to unify the two types of 
 * sorts in the "Latest" section and in the "Thread search" 
 * section. Being dynamic research, if a sorting type is not 
 * available, the replacement sort is chosen.
 * 
 * `date`: Order based on the latest update
 *
 * `likes`: Order based on the number of likes received. Replacement: `replies`.
 * 
 * `relevance`: Order based on the relevance of the result (or rating).
 * 
 * `replies`: Order based on the number of answers to the thread. Replacement: `views`.
 * 
 * `title`: Order based on the growing alphabetical order of the titles.
 * 
 * `views`: Order based on the number of visits. Replacement: `replies`.
 */
type THandiworkOrder = "date" | "likes" | "relevance" | "replies" | "title" | "views";

export default class HandiworkSearchQuery implements IQuery {
    
    //#region Private fields
    static MIN_PAGE = 1;
    //#endregion Private fields

    //#region Properties
    /**
     * Keywords to use in the search.
     */
    public keywords: string = "";
    /**
     * The results must be more recent than the date indicated.
     */
    public newerThan: Date = null;
    /**
     * The results must be older than the date indicated.
     */
    public olderThan: Date = null;
    public includedTags: string[] = [];
    /**
     * Tags to exclude from the search.
     */
    public excludedTags: string[] = [];
    public includedPrefixes: string[];
    public category: TCategory;
    /**
     * Results presentation order.
     */
    public order: THandiworkOrder = "relevance";
    @validator.IsInt({
        message: "$property expect an integer, received $value"
    })
    @validator.Min(HandiworkSearchQuery.MIN_PAGE, {
        message: "The minimum $property value must be $constraint1, received $value"
    })
    public page: number = 1;
    itype: TQueryInterface = "HandiworkSearchQuery";
    //#endregion Properties

    //#region Public methods
    /**
     * Select what kind of search should be 
     * performed based on the properties of 
     * the query.
     */
    public selectSearchType(): "latest" | "thread" {
        // Local variables
        const MAX_TAGS_LATEST_SEARCH = 5;
        const DEFAULT_SEARCH_TYPE = "latest";

        // If the keywords are set or the number 
        // of included tags is greather than 5, 
        // we must perform a thread search
        if (this.keywords || this.includedTags.length > MAX_TAGS_LATEST_SEARCH) return "thread";

        return DEFAULT_SEARCH_TYPE;
    }

    public validate(): boolean {
        return validator.validateSync(this).length === 0;
    }

    public createURL(): URL {
        // Local variables
        let query: LatestSearchQuery | ThreadSearchQuery = null;

        // Check if the query is valid
        if (!this.validate()) {
            throw new Error(`Invalid query: ${validator.validateSync(this).join("\n")}`);
        }

        // Convert the query
        if (this.selectSearchType() === "latest") query = this.cast<LatestSearchQuery>();
        else query = this.cast<ThreadSearchQuery>();

        return query.createURL();
    }

    public cast<T extends IQuery>(): T {
        // Local variables
        let returnValue = null;

        // Cast the query
        const query:T = {} as IQuery as T;
        
        // Convert the query
        if (query.itype === "LatestSearchQuery") returnValue = this.castToLatest();
        else if (query.itype === "ThreadSearchQuery") returnValue = this.castToThread();
        else returnValue = this as HandiworkSearchQuery;

        // Cast the result to T
        return returnValue as T;
    }
    //#endregion Public methods

    //#region Private methods
    private castToLatest(): LatestSearchQuery {
        // Cast the basic query object
        const query: LatestSearchQuery = this as IQuery as LatestSearchQuery;
        let orderFilter = this.order as string;
        query.itype = "LatestSearchQuery";

        // Adapt order filter
        if (orderFilter === "relevance") orderFilter = "rating";
        else if (orderFilter === "replies") orderFilter = "views";
        query.order = orderFilter as TLatestOrder;

        // Adapt date
        if (this.newerThan) query.date = query.findNearestDate(this.newerThan);

        return query;
    }

    private castToThread(): ThreadSearchQuery {
        // Cast the basic query object
        const query: ThreadSearchQuery = this as IQuery as ThreadSearchQuery;
        let orderFilter = this.order as string;

        // Set common values
        query.excludedTags = this.excludedTags;
        query.newerThan = this.newerThan;
        query.olderThan = this.olderThan;
        query.onlyTitles = true;
        query.keywords = this.keywords;

        // Adapt order filter
        if (orderFilter === "likes" || orderFilter === "title") orderFilter = "relevance";
        query.order = orderFilter as TThreadOrder;

        return query;
    }
    //#endregion
}