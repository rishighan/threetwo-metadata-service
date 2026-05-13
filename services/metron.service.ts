"use strict";

import { Service, ServiceBroker, Context, Errors } from "moleculer";
import axios, { AxiosResponse, AxiosError } from "axios";
import {
	MetronSeriesDetail,
	MetronIssueDetail,
	MetronSeriesSearchResult,
	MetronIssueSearchResult,
	RateLimitState,
	CachedResource,
	MetronScrapingStatus,
	MetronScrapingStage,
	MetronVolumeSearchParams,
	MetronVolumeSearchResult,
	MetronScorerConfig,
	SearchSeriesParams,
	GetSeriesByIdParams,
	SearchIssuesParams,
	GetIssueByIdParams,
	METRON_ERROR_CODES,
	ScoredMetronMatch,
} from "../types/metron.types";
import {
	rankMetronSeries,
	scoreMetronMatches,
	IssueMatchCandidate,
} from "../utils/metron-scorer.utils";

const { MoleculerError } = Errors;

// ============================================
// Constants
// ============================================

/** Base URL for the Metron API */
const METRON_BASE_URL = "https://metron.cloud/api";

/** Default timeout for API requests in milliseconds */
const DEFAULT_TIMEOUT = 30000;

/** Maximum number of top-ranked series to search for issues */
const MAX_SERIES_TO_SEARCH = 5;

/** Maximum number of issues to fetch per series */
const MAX_ISSUES_PER_SERIES = 20;

/** Cache time-to-live in milliseconds (5 minutes) */
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Metron Service for the ThreeTwo Metadata Service.
 *
 * Provides integration with the Metron comic database API (https://metron.cloud).
 * This service handles authentication, rate limiting, caching, and provides
 * actions for searching and retrieving comic series and issue metadata.
 *
 * @extends Service
 *
 * @example
 * // Search for series by name
 * const series = await broker.call("v1.metron.searchSeries", { name: "Batman" });
 *
 * @example
 * // Get issue details by ID
 * const issue = await broker.call("v1.metron.getIssueById", { id: 12345 });
 *
 * @example
 * // Perform volume-based search with scoring
 * const results = await broker.call("v1.metron.volumeBasedSearch", {
 *   scorerConfiguration: {
 *     searchParams: { name: "Batman", issueNumber: "1", year: "2016" }
 *   }
 * });
 *
 * @requires METRON_USERNAME - Environment variable for API authentication
 * @requires METRON_PASSWORD - Environment variable for API authentication
 */
export default class MetronService extends Service {
	/**
	 * Current rate limit state from the Metron API.
	 * Updated after each API request from response headers.
	 * @private
	 */
	private rateLimitState: RateLimitState | null = null;

	/**
	 * In-memory cache for API responses.
	 * Uses Last-Modified headers for conditional requests (304 Not Modified).
	 * @private
	 */
	private resourceCache: Map<string, CachedResource> = new Map();

	/**
	 * Interval handle for periodic cache cleanup.
	 * @private
	 */
	private cacheCleanupInterval: ReturnType<typeof setInterval> | null = null;

	/**
	 * Creates an instance of MetronService.
	 *
	 * @param {ServiceBroker} broker - The Moleculer service broker instance
	 */
	public constructor(public broker: ServiceBroker) {
		super(broker);
		this.parseServiceSchema({
			name: "metron",
			version: 1,

			settings: {
				metronBaseUrl: METRON_BASE_URL,
				defaultTimeout: DEFAULT_TIMEOUT,
			},

			actions: {
				// ============================================
				// Health Check
				// ============================================

				/**
				 * Health check action to verify service status and configuration.
				 *
				 * @action v1.metron.health
				 * @returns {Object} Health status object
				 * @returns {string} return.status - "ok" if configured, "unconfigured" otherwise
				 * @returns {boolean} return.configured - Whether API credentials are set
				 * @returns {RateLimitState|null} return.rateLimit - Current rate limit state
				 *
				 * @example
				 * const health = await broker.call("v1.metron.health");
				 * // { status: "ok", configured: true, rateLimit: { burstRemaining: 95, ... } }
				 */
				health: {
					rest: "GET /health",
					handler: async () => {
						const configured = this.isConfigured();
						return {
							status: configured ? "ok" : "unconfigured",
							configured,
							rateLimit: this.rateLimitState,
						};
					},
				},

				// ============================================
				// Series Actions
				// ============================================

				/**
				 * Search for comic series by name.
				 *
				 * @action v1.metron.searchSeries
				 * @param {string} name - Series name to search for
				 * @param {number} [page=1] - Page number for pagination
				 * @returns {Promise<MetronSeriesSearchResult>} Paginated search results
				 * @throws {MoleculerError} METRON_AUTH_MISSING - If credentials not configured
				 * @throws {MoleculerError} METRON_AUTH_FAILED - If authentication fails
				 * @throws {MoleculerError} METRON_RATE_LIMITED - If rate limit exceeded
				 *
				 * @example
				 * const result = await broker.call("v1.metron.searchSeries", {
				 *   name: "Batman",
				 *   page: 1
				 * });
				 * // { count: 150, results: [{ id: 1, name: "Batman", ... }], next: "...", previous: null }
				 */
				searchSeries: {
					rest: "GET /series/search",
					params: {
						name: { type: "string" },
						page: { type: "number", optional: true, default: 1 },
					},
					handler: async (ctx: Context<SearchSeriesParams>): Promise<MetronSeriesSearchResult> => {
						this.validateConfiguration();

						const { name, page = 1 } = ctx.params;

						const response = await this.makeRequest<MetronSeriesSearchResult>(
							"/series/",
							{ name, page }
						);

						return response;
					},
				},

				/**
				 * Get detailed information for a specific series by ID.
				 *
				 * @action v1.metron.getSeriesById
				 * @param {number} id - Metron series ID
				 * @returns {Promise<MetronSeriesDetail>} Detailed series information
				 * @throws {MoleculerError} METRON_AUTH_MISSING - If credentials not configured
				 * @throws {MoleculerError} METRON_NOT_FOUND - If series ID not found
				 *
				 * @example
				 * const series = await broker.call("v1.metron.getSeriesById", { id: 1234 });
				 * // { id: 1234, name: "Batman", publisher: { name: "DC Comics" }, ... }
				 */
				getSeriesById: {
					rest: "GET /series/:id",
					params: {
						id: { type: "number", convert: true },
					},
					handler: async (ctx: Context<GetSeriesByIdParams>): Promise<MetronSeriesDetail> => {
						this.validateConfiguration();

						const { id } = ctx.params;

						const response = await this.makeRequest<MetronSeriesDetail>(
							`/series/${id}/`,
							{}
						);

						return response;
					},
				},

				// ============================================
				// Issue Actions
				// ============================================

				/**
				 * Search for comic issues with various filters.
				 *
				 * @action v1.metron.searchIssues
				 * @param {number} [series_id] - Filter by series ID
				 * @param {string} [series_name] - Filter by series name
				 * @param {string} [issueNumber] - Filter by issue number
				 * @param {number} [cover_year] - Filter by cover year
				 * @param {number} [cover_month] - Filter by cover month
				 * @param {number} [page=1] - Page number for pagination
				 * @returns {Promise<MetronIssueSearchResult>} Paginated search results
				 * @throws {MoleculerError} METRON_AUTH_MISSING - If credentials not configured
				 *
				 * @example
				 * const issues = await broker.call("v1.metron.searchIssues", {
				 *   series_id: 1234,
				 *   issueNumber: "1",
				 *   cover_year: 2024
				 * });
				 */
				searchIssues: {
					rest: "GET /issue/search",
					params: {
						// eslint-disable-next-line camelcase
						series_id: { type: "number", optional: true, convert: true },
						// eslint-disable-next-line camelcase
						series_name: { type: "string", optional: true },
						issueNumber: { type: "string", optional: true },
						// eslint-disable-next-line camelcase
						cover_year: { type: "number", optional: true, convert: true },
						// eslint-disable-next-line camelcase
						cover_month: { type: "number", optional: true, convert: true },
						page: { type: "number", optional: true, default: 1 },
					},
					handler: async (ctx: Context<SearchIssuesParams>): Promise<MetronIssueSearchResult> => {
						this.validateConfiguration();

						const params: Record<string, unknown> = {};

						if (ctx.params.series_id) {
							// eslint-disable-next-line camelcase
							params.series_id = ctx.params.series_id;
						}
						if (ctx.params.series_name) {
							// eslint-disable-next-line camelcase
							params.series_name = ctx.params.series_name;
						}
						if (ctx.params.issueNumber) {
							// Map to API field name 'number' (Metron API uses this field name)
							// eslint-disable-next-line id-denylist
							params.number = ctx.params.issueNumber;
						}
						if (ctx.params.cover_year) {
							// eslint-disable-next-line camelcase
							params.cover_year = ctx.params.cover_year;
						}
						if (ctx.params.cover_month) {
							// eslint-disable-next-line camelcase
							params.cover_month = ctx.params.cover_month;
						}
						if (ctx.params.page) {
							params.page = ctx.params.page;
						}

						const response = await this.makeRequest<MetronIssueSearchResult>(
							"/issue/",
							params
						);

						return response;
					},
				},

				/**
				 * Get detailed information for a specific issue by ID.
				 *
				 * Returns comprehensive issue metadata including credits, characters,
				 * story arcs, variants, and cross-references to ComicVine/GCD.
				 *
				 * @action v1.metron.getIssueById
				 * @param {number} id - Metron issue ID
				 * @returns {Promise<MetronIssueDetail>} Detailed issue information
				 * @throws {MoleculerError} METRON_AUTH_MISSING - If credentials not configured
				 * @throws {MoleculerError} METRON_NOT_FOUND - If issue ID not found
				 *
				 * @example
				 * const issue = await broker.call("v1.metron.getIssueById", { id: 56789 });
				 * // { id: 56789, issueNumber: "1", title: "I Am Gotham", credits: [...], ... }
				 */
				getIssueById: {
					rest: "GET /issue/:id",
					params: {
						id: { type: "number", convert: true },
					},
					handler: async (ctx: Context<GetIssueByIdParams>): Promise<MetronIssueDetail> => {
						this.validateConfiguration();

						const { id } = ctx.params;

						const response = await this.makeRequest<MetronIssueDetail>(
							`/issue/${id}/`,
							{}
						);

						// Map the 'number' field to 'issueNumber' for TypeScript compatibility
						// Use intermediate variable to avoid restricted identifier lint error
						const issueNumberValue = (response as unknown as Record<string, string>).number;
						const mappedResponse = {
							...response,
							issueNumber: issueNumberValue,
						};

						return mappedResponse;
					},
				},

				// ============================================
				// Volume-Based Search (Main Search Action)
				// ============================================

				/**
				 * Perform an intelligent volume-based search with scoring.
				 *
				 * This is the primary search action that orchestrates a multi-stage search:
				 * 1. Searches for matching series by name
				 * 2. Ranks series by relevance to search parameters
				 * 3. Fetches issues from top-ranked series
				 * 4. Retrieves detailed issue information
				 * 5. Scores and ranks all matches
				 *
				 * Broadcasts progress via Socket.IO events (METRON_SCRAPING_STATUS).
				 *
				 * @action v1.metron.volumeBasedSearch
				 * @param {Object} scorerConfiguration - Configuration for search and scoring
				 * @param {Object} scorerConfiguration.searchParams - Search parameters
				 * @param {string} scorerConfiguration.searchParams.name - Series name to search
				 * @param {string} [scorerConfiguration.searchParams.issueNumber] - Issue number to match
				 * @param {string} [scorerConfiguration.searchParams.year] - Publication year to match
				 * @param {string} [scorerConfiguration.searchParams.subtitle] - Subtitle for additional matching
				 * @param {Object} [rawFileDetails] - Original file details for context
				 * @returns {Promise<MetronVolumeSearchResult>} Scored and ranked matches
				 * @throws {MoleculerError} METRON_AUTH_MISSING - If credentials not configured
				 *
				 * @fires METRON_SCRAPING_STATUS - Progress updates via Socket.IO
				 *
				 * @example
				 * const results = await broker.call("v1.metron.volumeBasedSearch", {
				 *   scorerConfiguration: {
				 *     searchParams: {
				 *       name: "Batman",
				 *       issueNumber: "1",
				 *       year: "2016"
				 *     }
				 *   },
				 *   rawFileDetails: {
				 *     name: "Batman (2016) #001.cbz",
				 *     containedIn: "/comics/dc/"
				 *   }
				 * });
				 * // { finalMatches: [{ issue: {...}, series: {...}, score: 95.5 }], ... }
				 */
				volumeBasedSearch: {
					rest: "POST /volumeBasedSearch",
					params: {
						scorerConfiguration: {
							type: "object",
							props: {
								searchParams: {
									type: "object",
									props: {
										name: { type: "string" },
										issueNumber: { type: "string", optional: true },
										year: { type: "string", optional: true },
										subtitle: { type: "string", optional: true },
									},
								},
							},
						},
						rawFileDetails: { type: "object", optional: true },
					},
					timeout: 10000000,
					handler: async (ctx: Context<MetronVolumeSearchParams>): Promise<MetronVolumeSearchResult> => {
						this.validateConfiguration();

						const { scorerConfiguration, rawFileDetails } = ctx.params;
						const { searchParams } = scorerConfiguration;

						try {
							// Stage 1: Search for series
							await this.broadcastStatus(ctx, "fetching_series", `Searching Metron for series: ${searchParams.name}`);

							const seriesResults = await ctx.call<MetronSeriesSearchResult, SearchSeriesParams>(
								"v1.metron.searchSeries",
								{ name: searchParams.name }
							);

							if (!seriesResults.results || seriesResults.results.length === 0) {
								await this.broadcastStatus(ctx, "complete", "No series found matching the search criteria");
								return {
									finalMatches: [],
									rawFileDetails,
									scorerConfiguration,
								};
							}

							// Stage 2: Rank series
							await this.broadcastStatus(ctx, "ranking_series", `Ranking ${seriesResults.results.length} series matches`);

							const rankedSeries = rankMetronSeries(seriesResults.results, scorerConfiguration);
							const topSeriesBasic = rankedSeries.slice(0, MAX_SERIES_TO_SEARCH);

							// Stage 2.5: Fetch full series details to get cover images
							// The series search endpoint returns minimal data without images
							await this.broadcastStatus(ctx, "fetching_series", `Fetching details for top ${topSeriesBasic.length} series`);

							const seriesDetailsPromises = topSeriesBasic.map(async series => {
								try {
									const seriesDetail = await ctx.call<MetronSeriesDetail, GetSeriesByIdParams>(
										"v1.metron.getSeriesById",
										{ id: series.id }
									);
									// Merge the detail with ranked series data (preserve match scores)
									return {
										...series,
										...seriesDetail,
									};
								} catch (error) {
									this.logger.warn(`Failed to fetch series details for ${series.id}:`, error);
									// Fall back to the basic series data
									return series;
								}
							});

							const topSeries = await Promise.all(seriesDetailsPromises);

							// Stage 3: Search for issues in top series
							await this.broadcastStatus(ctx, "searching_issues", `Searching issues in top ${topSeries.length} series`);

							const issueSearchPromises = topSeries.map(async series => {
								const issueSearchParams: SearchIssuesParams = {
									// eslint-disable-next-line camelcase
									series_id: series.id,
								};

								if (scorerConfiguration.searchParams.issueNumber) {
									issueSearchParams.issueNumber = scorerConfiguration.searchParams.issueNumber;
								}

								if (scorerConfiguration.searchParams.year) {
									// eslint-disable-next-line camelcase
									issueSearchParams.cover_year = parseInt(scorerConfiguration.searchParams.year, 10);
								}

								try {
									const issues = await ctx.call<MetronIssueSearchResult, SearchIssuesParams>(
										"v1.metron.searchIssues",
										issueSearchParams
									);
									return { series, issues: issues.results.slice(0, MAX_ISSUES_PER_SERIES) };
								} catch (error) {
									this.logger.warn(`Failed to search issues for series ${series.id}:`, error);
									return { series, issues: [] };
								}
							});

							const issueSearchResults = await Promise.all(issueSearchPromises);

							// Stage 4: Fetch issue details
							await this.broadcastStatus(ctx, "fetching_details", "Fetching detailed issue information");

							const candidates: IssueMatchCandidate[] = [];

							for (const { series, issues } of issueSearchResults) {
								for (const issue of issues) {
									try {
										const issueDetail = await ctx.call<MetronIssueDetail, GetIssueByIdParams>(
											"v1.metron.getIssueById",
											{ id: issue.id }
										);

										candidates.push({
											issue: issueDetail,
											series,
										});
									} catch (error) {
										this.logger.warn(`Failed to fetch issue details for ${issue.id}:`, error);
									}
								}
							}

							// Stage 5: Score matches
							await this.broadcastStatus(ctx, "scoring_matches", `Scoring ${candidates.length} issue matches`);

							const scoredMatches = scoreMetronMatches(candidates, scorerConfiguration);

							// Ensure all matches have valid series.name to prevent GraphQL null errors
							// GraphQL schema requires series.name to be non-null (String!)
							const validatedMatches = scoredMatches
								.filter(match => {
									// Filter out matches without a valid issue
									if (!match.issue?.id) {
										this.logger.warn("Filtering out match with missing issue id");
										return false;
									}
									// Filter out matches without a valid series
									if (!match.series?.id) {
										this.logger.warn("Filtering out match with missing series id");
										return false;
									}
									return true;
								})
								.map(match => {
									// Ensure series.name is never null/undefined
									// Use fallbacks: sort_name, issue.series.name, or "Unknown Series"
									const seriesName = match.series.name
										|| match.series.sort_name
										|| (match.issue.series as { name?: string })?.name
										|| `Series #${match.series.id}`;

									// Fallback for series.image: use the issue cover if series has no image
									// Some series in Metron don't have dedicated cover images
									const seriesImage = match.series.image || match.issue.image || "";

									return {
										...match,
										series: {
											...match.series,
											name: seriesName,
											image: seriesImage,
										},
									};
								});

							// Stage 6: Complete
							await this.broadcastStatus(ctx, "complete", `Found ${validatedMatches.length} matches`);

							return {
								finalMatches: validatedMatches,
								rawFileDetails,
								scorerConfiguration,
							};
						} catch (err: unknown) {
							const error = err as Error & { code?: string };
							const errorMessage = error.message || "Unknown error";
							await this.broadcastStatus(ctx, "error", `Search failed: ${errorMessage}`, {
								code: error.code || "UNKNOWN",
								context: "volumeBasedSearch",
								retryable: true,
							});
							throw error;
						}
					},
				},

				// ============================================
				// Utility Actions
				// ============================================

				/**
				 * Calculate match scores for a list of issue candidates.
				 *
				 * Useful for re-scoring matches with different configurations
				 * without performing additional API requests.
				 *
				 * @action v1.metron.getMetronMatchScores
				 * @param {IssueMatchCandidate[]} candidates - Array of issue/series pairs to score
				 * @param {MetronScorerConfig} scorerConfiguration - Scoring configuration
				 * @returns {ScoredMetronMatch[]} Scored and sorted matches
				 *
				 * @example
				 * const scored = await broker.call("v1.metron.getMetronMatchScores", {
				 *   candidates: [{ issue: {...}, series: {...} }],
				 *   scorerConfiguration: { searchParams: { name: "Batman", issueNumber: "1" } }
				 * });
				 */
				getMetronMatchScores: {
					rest: "POST /matchScores",
					params: {
						candidates: { type: "array" },
						scorerConfiguration: { type: "object" },
					},
					handler: (ctx: Context<{
						candidates: IssueMatchCandidate[];
						scorerConfiguration: MetronScorerConfig;
					}>): ScoredMetronMatch[] => {
						const { candidates, scorerConfiguration } = ctx.params;
						return scoreMetronMatches(candidates, scorerConfiguration);
					},
				},

				/**
				 * Fetch an arbitrary resource from the Metron API.
				 *
				 * @action v1.metron.fetchResource
				 * @param {string} resource - API endpoint path (e.g., "/publisher/1/")
				 * @returns {Promise<unknown>} Raw API response data
				 * @throws {MoleculerError} METRON_AUTH_MISSING - If credentials not configured
				 *
				 * @deprecated Use specific actions (searchSeries, getSeriesById, searchIssues, getIssueById) instead
				 *
				 * @example
				 * const publisher = await broker.call("v1.metron.fetchResource", {
				 *   resource: "/publisher/1/"
				 * });
				 */
				fetchResource: {
					rest: "GET /fetch",
					params: {
						resource: { type: "string" },
					},
					handler: async (ctx: Context<{ resource: string }>): Promise<unknown> => {
						this.validateConfiguration();

						const { resource } = ctx.params;
						const endpoint = resource.startsWith("/") ? resource : `/${resource}`;

						return this.makeRequest(endpoint, {});
					},
				},
			},

			events: {},

			created: () => {
				// Log configuration status
				if (this.isConfigured()) {
					this.logger.info("Metron service initialized with API credentials");
				} else {
					this.logger.warn(
						"Metron service initialized WITHOUT credentials. " +
						"Set METRON_USERNAME and METRON_PASSWORD environment variables to enable API access."
					);
				}
			},

			started: async () => {
				// Start cache cleanup interval
				this.cacheCleanupInterval = setInterval(() => {
					this.cleanCache();
				}, CACHE_TTL_MS);

				this.logger.info("Metron service started");
			},

			stopped: async () => {
				// Clear cache cleanup interval
				if (this.cacheCleanupInterval) {
					clearInterval(this.cacheCleanupInterval);
				}

				// Clear cache
				this.resourceCache.clear();

				this.logger.info("Metron service stopped");
			},
		});
	}

	// ============================================
	// Helper Methods
	// ============================================

	/**
	 * Checks if the service is properly configured with API credentials.
	 *
	 * @returns {boolean} True if both METRON_USERNAME and METRON_PASSWORD are set
	 * @private
	 */
	private isConfigured(): boolean {
		const username = process.env.METRON_USERNAME;
		const password = process.env.METRON_PASSWORD;
		return !!(username && password);
	}

	/**
	 * Validates that API credentials are configured.
	 *
	 * @throws {MoleculerError} METRON_AUTH_MISSING if credentials are not set
	 * @private
	 */
	private validateConfiguration(): void {
		if (!this.isConfigured()) {
			throw new MoleculerError(
				"Metron API credentials not configured. Set METRON_USERNAME and METRON_PASSWORD environment variables.",
				401,
				METRON_ERROR_CODES.AUTH_MISSING
			);
		}
	}

	/**
	 * Makes an authenticated HTTP request to the Metron API.
	 *
	 * Handles:
	 * - Basic authentication using environment credentials
	 * - Conditional requests using If-Modified-Since headers
	 * - Response caching with Last-Modified headers
	 * - Rate limit tracking from response headers
	 * - Rate limit waiting when limits are low
	 *
	 * @template T - Expected response type
	 * @param {string} endpoint - API endpoint path (e.g., "/series/")
	 * @param {Record<string, unknown>} params - Query parameters
	 * @returns {Promise<T>} Parsed API response
	 * @throws {MoleculerError} Various error codes for different failure scenarios
	 * @private
	 */
	private async makeRequest<T>(
		endpoint: string,
		params: Record<string, unknown>
	): Promise<T> {
		// Check rate limit before making request
		await this.waitForRateLimit();

		const url = `${METRON_BASE_URL}${endpoint}`;
		const cacheKey = `${endpoint}:${JSON.stringify(params)}`;

		// Check cache for conditional request
		const cached = this.resourceCache.get(cacheKey);
		const headers: Record<string, string> = {
			"Accept": "application/json",
			"User-Agent": "ThreeTwo/1.0 (Metron API Client)",
		};

		if (cached?.lastModified) {
			headers["If-Modified-Since"] = cached.lastModified;
		}

		const username = process.env.METRON_USERNAME;
		const password = process.env.METRON_PASSWORD;

		try {
			const response: AxiosResponse<T> = await axios.get(url, {
				params,
				headers,
				timeout: DEFAULT_TIMEOUT,
				auth: username && password ? { username, password } : undefined,
			});

			// Update rate limit state from response headers
			this.updateRateLimitState(response);

			// Cache the response
			const lastModified = response.headers["last-modified"] as string | undefined;
			if (lastModified) {
				this.resourceCache.set(cacheKey, {
					data: response.data,
					lastModified,
					cachedAt: Date.now(),
				});
			}

			return response.data;
		} catch (err: unknown) {
			const error = err as AxiosError;
			return this.handleRequestError<T>(error, cacheKey, cached);
		}
	}

	/**
	 * Handles HTTP request errors and maps them to appropriate MoleculerErrors.
	 *
	 * Error mapping:
	 * - 304: Returns cached data (not modified)
	 * - 401: METRON_AUTH_FAILED
	 * - 404: METRON_NOT_FOUND
	 * - 429: METRON_RATE_LIMITED (includes retry-after)
	 * - ECONNABORTED: METRON_TIMEOUT
	 * - Other: METRON_API_ERROR or METRON_UNKNOWN_ERROR
	 *
	 * @template T - Expected response type
	 * @param {AxiosError} error - The Axios error to handle
	 * @param {string} cacheKey - Cache key for 304 response handling
	 * @param {CachedResource} [cached] - Cached data to return on 304
	 * @returns {T} Cached data if 304 response
	 * @throws {MoleculerError} Appropriate error for the failure type
	 * @private
	 */
	private handleRequestError<T>(
		error: AxiosError,
		cacheKey: string,
		cached?: CachedResource
	): T {
		if (error.response) {
			const status = error.response.status;

			// Handle 304 Not Modified - return cached data
			if (status === 304 && cached) {
				return cached.data as T;
			}

			// Handle 401 Unauthorized
			if (status === 401) {
				throw new MoleculerError(
					"Metron API authentication failed. Check your credentials.",
					401,
					METRON_ERROR_CODES.AUTH_FAILED
				);
			}

			// Handle 404 Not Found
			if (status === 404) {
				throw new MoleculerError(
					"Resource not found on Metron API.",
					404,
					METRON_ERROR_CODES.NOT_FOUND
				);
			}

			// Handle 429 Rate Limited
			if (status === 429) {
				const retryAfter = error.response.headers["retry-after"] as string | undefined;
				throw new MoleculerError(
					`Rate limited by Metron API. Retry after: ${retryAfter || "unknown"}`,
					429,
					METRON_ERROR_CODES.RATE_LIMITED,
					{ retryAfter }
				);
			}

			// Handle other API errors
			throw new MoleculerError(
				`Metron API error: ${status} - ${error.message}`,
				status,
				METRON_ERROR_CODES.API_ERROR
			);
		}

		// Handle timeout
		if (error.code === "ECONNABORTED") {
			throw new MoleculerError(
				"Metron API request timed out.",
				408,
				METRON_ERROR_CODES.TIMEOUT
			);
		}

		// Handle unknown errors
		throw new MoleculerError(
			`Metron API request failed: ${error.message}`,
			500,
			METRON_ERROR_CODES.UNKNOWN
		);
	}

	/**
	 * Updates the rate limit state from API response headers.
	 *
	 * Metron API provides both burst and sustained rate limits:
	 * - Burst: Short-term limit (e.g., 100 requests per minute)
	 * - Sustained: Long-term limit (e.g., 1000 requests per hour)
	 *
	 * Logs a warning when approaching rate limits.
	 *
	 * @param {AxiosResponse} response - API response with rate limit headers
	 * @private
	 */
	private updateRateLimitState(response: AxiosResponse): void {
		const headers = response.headers;

		// Burst rate limit headers
		const burstLimit = parseInt(headers["x-ratelimit-burst-limit"] as string || "0", 10);
		const burstRemaining = parseInt(headers["x-ratelimit-burst-remaining"] as string || "0", 10);
		const burstReset = parseInt(headers["x-ratelimit-burst-reset"] as string || "0", 10);

		// Sustained rate limit headers
		const sustainedLimit = parseInt(headers["x-ratelimit-sustained-limit"] as string || "0", 10);
		const sustainedRemaining = parseInt(headers["x-ratelimit-sustained-remaining"] as string || "0", 10);
		const sustainedReset = parseInt(headers["x-ratelimit-sustained-reset"] as string || "0", 10);

		this.rateLimitState = {
			burstLimit,
			burstRemaining,
			burstReset,
			sustainedLimit,
			sustainedRemaining,
			sustainedReset,
		};

		// Log rate limit status if getting low
		if (burstRemaining <= 5 || sustainedRemaining <= 10) {
			this.logger.warn("Approaching Metron rate limit:", this.rateLimitState);
		}
	}

	/**
	 * Waits if the rate limit is exhausted or nearly exhausted.
	 *
	 * Implements automatic backoff:
	 * - Waits for full reset if burst limit exhausted
	 * - Waits for full reset if sustained limit exhausted
	 * - Adds small delay (500ms) when approaching limits
	 *
	 * @returns {Promise<void>}
	 * @private
	 */
	private async waitForRateLimit(): Promise<void> {
		if (!this.rateLimitState) {
			return;
		}

		const { burstRemaining, burstReset, sustainedRemaining, sustainedReset } = this.rateLimitState;

		// If burst limit is exhausted, wait for reset
		if (burstRemaining <= 0 && burstReset > 0) {
			const waitTime = burstReset * 1000;
			this.logger.info(`Waiting ${waitTime}ms for burst rate limit reset`);
			await this.delay(waitTime);
			return;
		}

		// If sustained limit is exhausted, wait for reset
		if (sustainedRemaining <= 0 && sustainedReset > 0) {
			const waitTime = sustainedReset * 1000;
			this.logger.info(`Waiting ${waitTime}ms for sustained rate limit reset`);
			await this.delay(waitTime);
			return;
		}

		// Add small delay if getting close to limits
		if (burstRemaining <= 2 || sustainedRemaining <= 5) {
			await this.delay(500);
		}
	}

	/**
	 * Creates a Promise that resolves after the specified delay.
	 *
	 * @param {number} ms - Delay in milliseconds
	 * @returns {Promise<void>}
	 * @private
	 */
	private delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	/**
	 * Broadcasts scraping status via Socket.IO for real-time progress updates.
	 *
	 * Emits METRON_SCRAPING_STATUS event with stage and message information.
	 * Gracefully handles cases where the socket service is unavailable.
	 *
	 * @param {Context} ctx - Moleculer context
	 * @param {MetronScrapingStage} stage - Current scraping stage
	 * @param {string} message - Human-readable status message
	 * @param {MetronScrapingStatus["error"]} [error] - Error details if stage is "error"
	 * @returns {Promise<void>}
	 * @private
	 *
	 * @fires METRON_SCRAPING_STATUS - Socket.IO event with status payload
	 */
	private async broadcastStatus(
		ctx: Context,
		stage: MetronScrapingStage,
		message: string,
		error?: MetronScrapingStatus["error"]
	): Promise<void> {
		const status: MetronScrapingStatus = {
			stage,
			message,
			error,
		};

		// Emit via broker for Socket.IO gateway to pick up
		try {
			await this.broker.call("socket.broadcast", {
				namespace: "/",
				event: "METRON_SCRAPING_STATUS",
				args: [status],
			});
		} catch (err) {
			// Socket service might not be available, just log
			this.logger.debug("Could not broadcast status:", err);
		}

		// Also log for debugging
		if (stage === "error") {
			this.logger.error("Metron scraping error:", message, error);
		} else {
			this.logger.info(`Metron scraping [${stage}]: ${message}`);
		}
	}

	/**
	 * Removes expired entries from the response cache.
	 *
	 * Called periodically via interval (every CACHE_TTL_MS).
	 * Entries older than CACHE_TTL_MS are removed.
	 *
	 * @private
	 */
	private cleanCache(): void {
		const now = Date.now();
		for (const [key, value] of this.resourceCache.entries()) {
			if (now - value.cachedAt > CACHE_TTL_MS) {
				this.resourceCache.delete(key);
			}
		}
	}
}
