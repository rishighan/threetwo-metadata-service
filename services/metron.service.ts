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

const METRON_BASE_URL = "https://metron.cloud/api";
const DEFAULT_TIMEOUT = 30000;
const MAX_SERIES_TO_SEARCH = 5; // Top N series to search for issues
const MAX_ISSUES_PER_SERIES = 20; // Max issues to fetch per series
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export default class MetronService extends Service {
	private rateLimitState: RateLimitState | null = null;
	private resourceCache: Map<string, CachedResource> = new Map();
	private cacheCleanupInterval: ReturnType<typeof setInterval> | null = null;

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
							const topSeries = rankedSeries.slice(0, MAX_SERIES_TO_SEARCH);

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

							// Stage 6: Complete
							await this.broadcastStatus(ctx, "complete", `Found ${scoredMatches.length} matches`);

							return {
								finalMatches: scoredMatches,
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
				 * Legacy action for backward compatibility
				 * @deprecated Use searchSeries, getSeriesById, searchIssues, or getIssueById instead
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
	 * Check if service is properly configured with credentials
	 */
	private isConfigured(): boolean {
		const username = process.env.METRON_USERNAME;
		const password = process.env.METRON_PASSWORD;
		return !!(username && password);
	}

	/**
	 * Validate configuration and throw if missing
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
	 * Make an authenticated request to the Metron API
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
	 * Handle request errors with appropriate error codes
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
	 * Update rate limit state from response headers
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
	 * Wait if we're close to rate limit
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
	 * Delay helper
	 */
	private delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	/**
	 * Broadcast scraping status via Socket.IO
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
	 * Clean expired entries from cache
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
