/**
 * Grand Comics Database (GCD) Types
 *
 * TypeScript interfaces for GCD database entities and service operations.
 * GCD data is queried from a local SQLite database dump.
 *
 * @see https://docs.comics.org/wiki/Database_Schema
 */

// ============================================
// Core Entity Types
// ============================================

/**
 * GCD Publisher entity
 */
export interface GCDPublisher {
	id: number;
	name: string;
	countryId: number | null;
	country: string | null;
	yearBegan: number | null;
	yearEnded: number | null;
	url: string | null;
}

/**
 * GCD Series entity (equivalent to "volume" in ComicVine)
 */
export interface GCDSeries {
	id: number;
	name: string;
	sortName: string | null;
	yearBegan: number | null;
	yearEnded: number | null;
	issueCount: number;
	publisherId: number;
	publisher?: GCDPublisher;
	notes: string | null;
	publishingFormat: string | null;
	publicationType: string | null;
	country: string | null;
	language: string | null;
}

/**
 * GCD Issue entity
 */
export interface GCDIssue {
	id: number;
	issueNumber: string;
	seriesId: number;
	series?: GCDSeries;
	title: string | null;
	publicationDate: string | null;
	keyDate: string | null; // YYYY-MM-DD format
	price: string | null;
	pageCount: number | null;
	barcode: string | null;
	isbn: string | null;
	variantOfId: number | null;
	variantName: string | null;
	notes: string | null;
}

/**
 * GCD Story entity (content within an issue)
 */
export interface GCDStory {
	id: number;
	title: string | null;
	typeId: number;
	sequenceNumber: number;
	issueId: number;
	pageCount: number | null;
	synopsis: string | null;
	characters: string | null;
	credits?: GCDCredit[];
}

/**
 * GCD Credit entity (creator with role)
 */
export interface GCDCredit {
	id: number;
	story_id: number;
	creator_id: number;
	credit_type_id: number;
	creator_name: string;
	role: string;
}

/**
 * GCD Creator entity
 */
export interface GCDCreator {
	id: number;
	name: string;
	sort_name: string | null;
	birth_date: string | null;
	death_date: string | null;
	bio: string | null;
}

// ============================================
// Search Result Types
// ============================================

/**
 * Paginated series search result
 */
export interface GCDSeriesSearchResult {
	count: number;
	results: GCDSeries[];
}

/**
 * Paginated issue search result
 */
export interface GCDIssueSearchResult {
	count: number;
	results: GCDIssue[];
}

// ============================================
// Scorer Configuration Types
// ============================================

/**
 * Configuration for GCD match scoring
 */
export interface GCDScorerConfig {
	searchParams: {
		name: string;
		issueNumber?: string;
		year?: string;
		publisher?: string;
		subtitle?: string;
	};
}

/**
 * A scored match result from volumeBasedSearch
 */
export interface ScoredGCDMatch {
	issue: GCDIssue;
	series: GCDSeries;
	score: number;
	nameMatchScore?: number;
	issueNumberScore?: number;
	yearScore?: number;
}

/**
 * Result from volumeBasedSearch action
 */
export interface GCDVolumeSearchResult {
	finalMatches: ScoredGCDMatch[];
	rawFileDetails?: Record<string, unknown>;
	scorerConfiguration: GCDScorerConfig;
}

// ============================================
// Service Parameter Types
// ============================================

/**
 * Parameters for searchSeries action
 */
export interface SearchSeriesParams {
	name: string;
	page?: number;
	limit?: number;
}

/**
 * Parameters for getSeriesById action
 */
export interface GetSeriesByIdParams {
	id: number;
}

/**
 * Parameters for searchIssues action
 */
export interface SearchIssuesParams {
	series_id?: number;
	series_name?: string;
	issueNumber?: string;
	year?: number;
	page?: number;
	limit?: number;
}

/**
 * Parameters for getIssueById action
 */
export interface GetIssueByIdParams {
	id: number;
}

/**
 * Parameters for getStoriesForIssue action
 */
export interface GetStoriesForIssueParams {
	issueId: number;
}

/**
 * Parameters for volumeBasedSearch action
 */
export interface GCDVolumeSearchParams {
	scorerConfiguration: GCDScorerConfig;
	rawFileDetails?: Record<string, unknown>;
}

// ============================================
// Health Check Types
// ============================================

/**
 * Health check response
 */
export interface GCDHealthResponse {
	status: "ok" | "unconfigured" | "error";
	configured: boolean;
	databasePath?: string;
	databaseSize?: string;
	lastModified?: string;
	error?: string;
}

// ============================================
// Error Codes
// ============================================

/**
 * GCD-specific error codes
 */
export const GCD_ERROR_CODES = {
	DATABASE_NOT_FOUND: "GCD_DATABASE_NOT_FOUND",
	DATABASE_ERROR: "GCD_DATABASE_ERROR",
	NOT_FOUND: "GCD_NOT_FOUND",
	INVALID_QUERY: "GCD_INVALID_QUERY",
	NOT_CONFIGURED: "GCD_NOT_CONFIGURED",
} as const;

export type GCDErrorCode = (typeof GCD_ERROR_CODES)[keyof typeof GCD_ERROR_CODES];

// ============================================
// Socket.IO Status Types
// ============================================

/**
 * Stages for GCD_SCRAPING_STATUS Socket.IO events
 */
export type GCDScrapingStage =
	| "searching_series"
	| "ranking_series"
	| "searching_issues"
	| "fetching_details"
	| "scoring_matches"
	| "complete"
	| "error";

/**
 * Status payload for GCD_SCRAPING_STATUS events
 */
export interface GCDScrapingStatus {
	stage: GCDScrapingStage;
	message: string;
	error?: {
		code: string;
		context: string;
		retryable?: boolean;
	};
}

// ============================================
// Internal Types
// ============================================

/**
 * Issue candidate for scoring (internal use)
 */
export interface IssueMatchCandidate {
	issue: GCDIssue;
	series: GCDSeries;
}

/**
 * Series with computed score (internal use)
 */
export interface RankedGCDSeries extends GCDSeries {
	_score: number;
}
