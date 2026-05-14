"use strict";

import * as fs from "fs";
import { Service, ServiceBroker, Context, Errors } from "moleculer";
import {
	GCDSeries,
	GCDIssue,
	GCDStory,
	GCDSeriesSearchResult,
	GCDIssueSearchResult,
	GCDVolumeSearchResult,
	GCDHealthResponse,
	GCDScrapingStage,
	GCDScrapingStatus,
	SearchSeriesParams,
	GetSeriesByIdParams,
	SearchIssuesParams,
	GetIssueByIdParams,
	GetStoriesForIssueParams,
	GCDVolumeSearchParams,
	GCD_ERROR_CODES,
	IssueMatchCandidate,
} from "../types/gcd.types";
import { rankGCDSeries, scoreGCDMatches } from "../utils/gcd-scorer.utils";

const { MoleculerError } = Errors;

// ============================================
// Constants
// ============================================

/** Maximum number of top-ranked series to search for issues */
const MAX_SERIES_TO_SEARCH = 5;

/** Maximum number of issues to fetch per series */
const MAX_ISSUES_PER_SERIES = 20;

/** Default page size for search results */
const DEFAULT_PAGE_SIZE = 20;

// ============================================
// Database Type (better-sqlite3)
// ============================================

// eslint-disable-next-line @typescript-eslint/no-require-imports
type Database = ReturnType<typeof require>;

/**
 * GCD Service for the ThreeTwo Metadata Service.
 *
 * Provides integration with the Grand Comics Database (GCD) via a local
 * SQLite database dump. Unlike ComicVine/Metron which use external APIs,
 * GCD queries a local database file for fast, offline-capable searches.
 *
 * @extends Service
 *
 * @example
 * // Search for series by name
 * const series = await broker.call("v1.gcd.searchSeries", { name: "Batman" });
 *
 * @example
 * // Get issue details by ID
 * const issue = await broker.call("v1.gcd.getIssueById", { id: 12345 });
 *
 * @requires GCD_DATABASE_PATH - Environment variable pointing to SQLite file
 */
export default class GCDService extends Service {
	/**
	 * SQLite database connection
	 * @private
	 */
	private db: Database | null = null;

	/**
	 * Creates an instance of GCDService.
	 *
	 * @param {ServiceBroker} broker - The Moleculer service broker instance
	 */
	public constructor(public broker: ServiceBroker) {
		super(broker);
		this.parseServiceSchema({
			name: "gcd",
			version: 1,

			settings: {
				defaultPageSize: DEFAULT_PAGE_SIZE,
			},

			actions: {
				// ============================================
				// Health Check
				// ============================================

				/**
				 * Health check action to verify database status.
				 *
				 * @action v1.gcd.health
				 * @returns {GCDHealthResponse} Health status object
				 */
				health: {
					rest: "GET /health",
					handler: async (): Promise<GCDHealthResponse> => {
						const configured = this.isConfigured();

						if (!configured) {
							return {
								status: "unconfigured",
								configured: false,
							};
						}

						try {
							const dbPath = process.env.GCD_DATABASE_PATH!;
							const stats = fs.statSync(dbPath);

							return {
								status: "ok",
								configured: true,
								databasePath: dbPath,
								databaseSize: this.formatBytes(stats.size),
								lastModified: stats.mtime.toISOString(),
							};
						} catch (err: unknown) {
							const error = err as Error;
							return {
								status: "error",
								configured: true,
								error: error.message,
							};
						}
					},
				},

				// ============================================
				// Series Actions
				// ============================================

				/**
				 * Search for comic series by name.
				 *
				 * @action v1.gcd.searchSeries
				 * @param {string} name - Series name to search for
				 * @param {number} [page=1] - Page number for pagination
				 * @param {number} [limit=20] - Results per page
				 * @returns {Promise<GCDSeriesSearchResult>} Paginated search results
				 */
				searchSeries: {
					rest: "GET /series/search",
					params: {
						name: { type: "string" },
						page: { type: "number", optional: true, default: 1, convert: true },
						limit: { type: "number", optional: true, default: DEFAULT_PAGE_SIZE, convert: true },
					},
					handler: async (ctx: Context<SearchSeriesParams>): Promise<GCDSeriesSearchResult> => {
						this.validateConfiguration();

						const { name, page = 1, limit = DEFAULT_PAGE_SIZE } = ctx.params;
						const offset = (page - 1) * limit;

						const stmt = this.db.prepare(`
							SELECT 
								s.id, s.name, s.sort_name, s.year_began, s.year_ended,
								s.issue_count, s.publisher_id, s.publishing_format, s.notes,
								p.id as pub_id, p.name as pub_name, p.year_began as pub_year_began
							FROM gcd_series s
							LEFT JOIN gcd_publisher p ON s.publisher_id = p.id
							WHERE s.name LIKE ?
							ORDER BY s.year_began DESC, s.name
							LIMIT ? OFFSET ?
						`);

						const countStmt = this.db.prepare(`
							SELECT COUNT(*) as count FROM gcd_series WHERE name LIKE ?
						`);

						const searchPattern = `%${name}%`;
						const rows = stmt.all(searchPattern, limit, offset);
						const countRow = countStmt.get(searchPattern) as { count: number };

						const results: GCDSeries[] = rows.map((row: Record<string, unknown>) =>
							this.mapRowToSeries(row)
						);

						return {
							count: countRow.count,
							results,
						};
					},
				},

				/**
				 * Get detailed information for a specific series by ID.
				 *
				 * @action v1.gcd.getSeriesById
				 * @param {number} id - GCD series ID
				 * @returns {Promise<GCDSeries>} Detailed series information
				 */
				getSeriesById: {
					rest: "GET /series/:id",
					params: {
						id: { type: "number", convert: true },
					},
					handler: async (ctx: Context<GetSeriesByIdParams>): Promise<GCDSeries> => {
						this.validateConfiguration();

						const stmt = this.db.prepare(`
							SELECT 
								s.id, s.name, s.sort_name, s.year_began, s.year_ended,
								s.issue_count, s.publisher_id, s.publishing_format, s.notes,
								p.id as pub_id, p.name as pub_name, p.year_began as pub_year_began
							FROM gcd_series s
							LEFT JOIN gcd_publisher p ON s.publisher_id = p.id
							WHERE s.id = ?
						`);

						const row = stmt.get(ctx.params.id) as Record<string, unknown> | undefined;

						if (!row) {
							throw new MoleculerError(
								"Series not found",
								404,
								GCD_ERROR_CODES.NOT_FOUND
							);
						}

						return this.mapRowToSeries(row);
					},
				},

				// ============================================
				// Issue Actions
				// ============================================

				/**
				 * Search for comic issues with various filters.
				 *
				 * @action v1.gcd.searchIssues
				 * @param {number} [series_id] - Filter by series ID
				 * @param {string} [series_name] - Filter by series name
				 * @param {string} [issueNumber] - Filter by issue number
				 * @param {number} [year] - Filter by year
				 * @param {number} [page=1] - Page number for pagination
				 * @param {number} [limit=20] - Results per page
				 * @returns {Promise<GCDIssueSearchResult>} Paginated search results
				 */
				searchIssues: {
					rest: "GET /issue/search",
					params: {
						// eslint-disable-next-line camelcase
						series_id: { type: "number", optional: true, convert: true },
						// eslint-disable-next-line camelcase
						series_name: { type: "string", optional: true },
						issueNumber: { type: "string", optional: true },
						year: { type: "number", optional: true, convert: true },
						page: { type: "number", optional: true, default: 1, convert: true },
						limit: { type: "number", optional: true, default: DEFAULT_PAGE_SIZE, convert: true },
					},
					handler: async (ctx: Context<SearchIssuesParams>): Promise<GCDIssueSearchResult> => {
						this.validateConfiguration();

						const { page = 1, limit = DEFAULT_PAGE_SIZE } = ctx.params;
						const offset = (page - 1) * limit;

						// Build dynamic WHERE clause
						const conditions: string[] = [];
						const params: (string | number)[] = [];

						if (ctx.params.series_id) {
							conditions.push("i.series_id = ?");
							params.push(ctx.params.series_id);
						}
						if (ctx.params.series_name) {
							conditions.push("s.name LIKE ?");
							params.push(`%${ctx.params.series_name}%`);
						}
						if (ctx.params.issueNumber) {
							conditions.push("i.number = ?");
							params.push(ctx.params.issueNumber);
						}
						if (ctx.params.year) {
							conditions.push("SUBSTR(i.key_date, 1, 4) = ?");
							params.push(ctx.params.year.toString());
						}

						const whereClause = conditions.length > 0
							? "WHERE " + conditions.join(" AND ")
							: "";

						const stmt = this.db.prepare(`
							SELECT 
								i.id, i.number, i.series_id, i.publication_date, i.key_date,
								i.price, i.page_count, i.barcode, i.isbn,
								i.variant_of_id, i.variant_name, i.notes,
								s.id as series_id, s.name as series_name, s.year_began, s.publisher_id
							FROM gcd_issue i
							JOIN gcd_series s ON i.series_id = s.id
							${whereClause}
							ORDER BY i.key_date DESC
							LIMIT ? OFFSET ?
						`);

						const countStmt = this.db.prepare(`
							SELECT COUNT(*) as count
							FROM gcd_issue i
							JOIN gcd_series s ON i.series_id = s.id
							${whereClause}
						`);

						const rows = stmt.all(...params, limit, offset);
						const countRow = countStmt.get(...params) as { count: number };

						const results: GCDIssue[] = rows.map((row: Record<string, unknown>) =>
							this.mapRowToIssue(row)
						);

						return {
							count: countRow.count,
							results,
						};
					},
				},

				/**
				 * Get detailed information for a specific issue by ID.
				 *
				 * @action v1.gcd.getIssueById
				 * @param {number} id - GCD issue ID
				 * @returns {Promise<GCDIssue>} Detailed issue information
				 */
				getIssueById: {
					rest: "GET /issue/:id",
					params: {
						id: { type: "number", convert: true },
					},
					handler: async (ctx: Context<GetIssueByIdParams>): Promise<GCDIssue> => {
						this.validateConfiguration();

						const stmt = this.db.prepare(`
							SELECT 
								i.id, i.number, i.series_id, i.publication_date, i.key_date,
								i.price, i.page_count, i.barcode, i.isbn,
								i.variant_of_id, i.variant_name, i.notes,
								s.id as s_id, s.name as series_name, s.sort_name, s.year_began, 
								s.year_ended, s.issue_count, s.publisher_id, s.publishing_format,
								p.id as pub_id, p.name as pub_name
							FROM gcd_issue i
							JOIN gcd_series s ON i.series_id = s.id
							LEFT JOIN gcd_publisher p ON s.publisher_id = p.id
							WHERE i.id = ?
						`);

						const row = stmt.get(ctx.params.id) as Record<string, unknown> | undefined;

						if (!row) {
							throw new MoleculerError(
								"Issue not found",
								404,
								GCD_ERROR_CODES.NOT_FOUND
							);
						}

						return this.mapRowToIssueWithSeries(row);
					},
				},

				/**
				 * Get stories for a specific issue.
				 *
				 * @action v1.gcd.getStoriesForIssue
				 * @param {number} issueId - GCD issue ID
				 * @returns {Promise<GCDStory[]>} Array of stories
				 */
				getStoriesForIssue: {
					rest: "GET /issue/:issueId/stories",
					params: {
						issueId: { type: "number", convert: true },
					},
					handler: async (ctx: Context<GetStoriesForIssueParams>): Promise<GCDStory[]> => {
						this.validateConfiguration();

						const stmt = this.db.prepare(`
							SELECT 
								st.id, st.title, st.type_id, st.sequence_number,
								st.issue_id, st.page_count, st.synopsis, st.characters
							FROM gcd_story st
							WHERE st.issue_id = ?
							ORDER BY st.sequence_number
						`);

						const rows = stmt.all(ctx.params.issueId);

						return rows.map((row: Record<string, unknown>) => {
							/* eslint-disable camelcase */
							const story: GCDStory = {
								id: row.id as number,
								title: row.title as string | null,
								type_id: row.type_id as number,
								sequence_number: row.sequence_number as number,
								issue_id: row.issue_id as number,
								page_count: row.page_count as number | null,
								synopsis: row.synopsis as string | null,
								characters: row.characters as string | null,
							};
							/* eslint-enable camelcase */
							return story;
						});
					},
				},

				// ============================================
				// Volume-Based Search
				// ============================================

				/**
				 * Perform an intelligent volume-based search with scoring.
				 *
				 * @action v1.gcd.volumeBasedSearch
				 * @param {Object} scorerConfiguration - Configuration for search and scoring
				 * @param {Object} [rawFileDetails] - Original file details for context
				 * @returns {Promise<GCDVolumeSearchResult>} Scored and ranked matches
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
										publisher: { type: "string", optional: true },
									},
								},
							},
						},
						rawFileDetails: { type: "object", optional: true },
					},
					timeout: 10000000,
					handler: async (ctx: Context<GCDVolumeSearchParams>): Promise<GCDVolumeSearchResult> => {
						this.validateConfiguration();

						const { scorerConfiguration, rawFileDetails } = ctx.params;
						const { searchParams } = scorerConfiguration;

						try {
							// Stage 1: Search for series
							await this.broadcastStatus(ctx, "searching_series", `Searching GCD for series: ${searchParams.name}`);

							const seriesStmt = this.db.prepare(`
								SELECT 
									s.id, s.name, s.sort_name, s.year_began, s.year_ended,
									s.issue_count, s.publisher_id, s.publishing_format, s.notes,
									p.id as pub_id, p.name as pub_name
								FROM gcd_series s
								LEFT JOIN gcd_publisher p ON s.publisher_id = p.id
								WHERE s.name LIKE ?
								ORDER BY s.year_began DESC
								LIMIT 100
							`);

							const seriesRows = seriesStmt.all(`%${searchParams.name}%`);
							const seriesResults: GCDSeries[] = seriesRows.map(
								(row: Record<string, unknown>) => this.mapRowToSeries(row)
							);

							if (seriesResults.length === 0) {
								await this.broadcastStatus(ctx, "complete", "No series found matching the search criteria");
								return {
									finalMatches: [],
									rawFileDetails,
									scorerConfiguration,
								};
							}

							// Stage 2: Rank series
							await this.broadcastStatus(ctx, "ranking_series", `Ranking ${seriesResults.length} series matches`);

							const rankedSeries = rankGCDSeries(seriesResults, scorerConfiguration);
							const topSeries = rankedSeries.slice(0, MAX_SERIES_TO_SEARCH);

							// Stage 3: Search for issues in top series
							await this.broadcastStatus(ctx, "searching_issues", `Searching issues in top ${topSeries.length} series`);

							const candidates: IssueMatchCandidate[] = [];

							for (const series of topSeries) {
								const conditions: string[] = ["i.series_id = ?"];
								const params: (string | number)[] = [series.id];

								if (searchParams.issueNumber) {
									conditions.push("i.number = ?");
									params.push(searchParams.issueNumber);
								}

								if (searchParams.year) {
									conditions.push("SUBSTR(i.key_date, 1, 4) = ?");
									params.push(searchParams.year);
								}

								const issueStmt = this.db.prepare(`
									SELECT 
										i.id, i.number, i.series_id, i.publication_date, i.key_date,
										i.price, i.page_count, i.barcode, i.isbn,
										i.variant_of_id, i.variant_name, i.notes
									FROM gcd_issue i
									WHERE ${conditions.join(" AND ")}
									ORDER BY i.key_date DESC
									LIMIT ?
								`);

								const issueRows = issueStmt.all(...params, MAX_ISSUES_PER_SERIES);

								for (const row of issueRows) {
									const issue = this.mapRowToIssue(row as Record<string, unknown>);
									issue.series = series;
									candidates.push({ issue, series });
								}
							}

							// Stage 4: Score matches
							await this.broadcastStatus(ctx, "scoring_matches", `Scoring ${candidates.length} issue matches`);

							const scoredMatches = scoreGCDMatches(candidates, scorerConfiguration);

							// Stage 5: Complete
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
			},

			events: {},

			created: () => {
				// Log configuration status
				if (this.isConfigured()) {
					this.logger.info("GCD service initialized with database path:", process.env.GCD_DATABASE_PATH);
				} else {
					this.logger.warn(
						"GCD service initialized WITHOUT database. " +
						"Set GCD_DATABASE_PATH environment variable to enable database access."
					);
				}
			},

			started: async () => {
				if (this.isConfigured()) {
					await this.openDatabase();
				}
				this.logger.info("GCD service started");
			},

			stopped: async () => {
				this.closeDatabase();
				this.logger.info("GCD service stopped");
			},
		});
	}

	// ============================================
	// Helper Methods
	// ============================================

	/**
	 * Checks if the service is properly configured with database path.
	 */
	private isConfigured(): boolean {
		const dbPath = process.env.GCD_DATABASE_PATH;
		return !!(dbPath && fs.existsSync(dbPath));
	}

	/**
	 * Validates that database is configured and connected.
	 */
	private validateConfiguration(): void {
		if (!process.env.GCD_DATABASE_PATH) {
			throw new MoleculerError(
				"GCD database path not configured. Set GCD_DATABASE_PATH environment variable.",
				503,
				GCD_ERROR_CODES.NOT_CONFIGURED
			);
		}

		if (!this.db) {
			throw new MoleculerError(
				"GCD database not connected.",
				503,
				GCD_ERROR_CODES.DATABASE_ERROR
			);
		}
	}

	/**
	 * Opens the SQLite database connection.
	 */
	private async openDatabase(): Promise<void> {
		const dbPath = process.env.GCD_DATABASE_PATH;

		if (!dbPath) {
			this.logger.warn("GCD_DATABASE_PATH not set, skipping database connection");
			return;
		}

		if (!fs.existsSync(dbPath)) {
			throw new MoleculerError(
				`GCD database file not found: ${dbPath}`,
				503,
				GCD_ERROR_CODES.DATABASE_NOT_FOUND
			);
		}

		try {
			// Dynamic import for better-sqlite3
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const BetterSqlite3 = require("better-sqlite3");

			this.db = new BetterSqlite3(dbPath, {
				readonly: true,
				fileMustExist: true,
			});

			// Performance optimizations (readonly-safe pragmas only)
			// Note: WAL mode cannot be set on readonly databases
			const cacheSize = process.env.GCD_CACHE_SIZE || "10000";
			this.db.pragma(`cache_size = ${cacheSize}`);
			this.db.pragma("temp_store = memory");

			this.logger.info("GCD database opened successfully:", dbPath);
		} catch (err: unknown) {
			const error = err as Error;
			throw new MoleculerError(
				`Failed to open GCD database: ${error.message}`,
				503,
				GCD_ERROR_CODES.DATABASE_ERROR
			);
		}
	}

	/**
	 * Closes the SQLite database connection.
	 */
	private closeDatabase(): void {
		if (this.db) {
			try {
				this.db.close();
				this.db = null;
				this.logger.info("GCD database closed");
			} catch (err: unknown) {
				const error = err as Error;
				this.logger.error("Error closing GCD database:", error.message);
			}
		}
	}

	/**
	 * Broadcasts scraping status via Socket.IO.
	 */
	private async broadcastStatus(
		ctx: Context,
		stage: GCDScrapingStage,
		message: string,
		error?: GCDScrapingStatus["error"]
	): Promise<void> {
		const status: GCDScrapingStatus = {
			stage,
			message,
			error,
		};

		try {
			await this.broker.call("socket.broadcast", {
				namespace: "/",
				event: "GCD_SCRAPING_STATUS",
				args: [status],
			});
		} catch (err) {
			// Socket service might not be available
			this.logger.debug("Could not broadcast status:", err);
		}

		// Also log for debugging
		if (stage === "error") {
			this.logger.error("GCD scraping error:", message, error);
		} else {
			this.logger.info(`GCD scraping [${stage}]: ${message}`);
		}
	}

	/**
	 * Maps a database row to a GCDSeries object.
	 */
	private mapRowToSeries(row: Record<string, unknown>): GCDSeries {
		/* eslint-disable camelcase */
		const series: GCDSeries = {
			id: row.id as number,
			name: row.name as string,
			sort_name: row.sort_name as string | null,
			year_began: row.year_began as number | null,
			year_ended: row.year_ended as number | null,
			issue_count: row.issue_count as number || 0,
			publisher_id: row.publisher_id as number,
			notes: row.notes as string | null,
			publishing_format: row.publishing_format as string | null,
		};

		// Add publisher if present
		if (row.pub_id) {
			series.publisher = {
				id: row.pub_id as number,
				name: row.pub_name as string,
				country_id: null,
				year_began: row.pub_year_began as number | null ?? null,
				year_ended: null,
				url: null,
			};
		}
		/* eslint-enable camelcase */

		return series;
	}

	/**
	 * Maps a database row to a GCDIssue object.
	 */
	private mapRowToIssue(row: Record<string, unknown>): GCDIssue {
		/* eslint-disable camelcase */
		const issue: GCDIssue = {
			id: row.id as number,
			issueNumber: row.number as string,
			series_id: row.series_id as number,
			publication_date: row.publication_date as string | null,
			key_date: row.key_date as string | null,
			price: row.price as string | null,
			page_count: row.page_count as number | null,
			barcode: row.barcode as string | null,
			isbn: row.isbn as string | null,
			variant_of_id: row.variant_of_id as number | null,
			variant_name: row.variant_name as string | null,
			notes: row.notes as string | null,
		};
		/* eslint-enable camelcase */
		return issue;
	}

	/**
	 * Maps a database row to a GCDIssue with embedded series.
	 */
	private mapRowToIssueWithSeries(row: Record<string, unknown>): GCDIssue {
		const issue = this.mapRowToIssue(row);

		/* eslint-disable camelcase */
		issue.series = {
			id: row.s_id as number || row.series_id as number,
			name: row.series_name as string,
			sort_name: row.sort_name as string | null,
			year_began: row.year_began as number | null,
			year_ended: row.year_ended as number | null,
			issue_count: row.issue_count as number || 0,
			publisher_id: row.publisher_id as number,
			notes: null,
			publishing_format: row.publishing_format as string | null,
		};

		// Add publisher to series if present
		if (row.pub_id) {
			issue.series.publisher = {
				id: row.pub_id as number,
				name: row.pub_name as string,
				country_id: null,
				year_began: null,
				year_ended: null,
				url: null,
			};
		}
		/* eslint-enable camelcase */

		return issue;
	}

	/**
	 * Formats bytes to human-readable string.
	 */
	private formatBytes(bytes: number): string {
		if (bytes === 0) {
			return "0 Bytes";
		}

		const k = 1024;
		const sizes = ["Bytes", "KB", "MB", "GB"];
		const i = Math.floor(Math.log(bytes) / Math.log(k));

		return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
	}
}
