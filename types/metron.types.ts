/**
 * Metron API TypeScript Interfaces
 * Based on https://metron.cloud/wiki/api/api-documentation/
 */

// ============================================
// Publisher Types
// ============================================

export interface MetronPublisher {
	id: number;
	name: string;
}

// ============================================
// Series Types
// ============================================

export interface MetronSeriesType {
	id: number;
	name: string;
}

export interface MetronSeries {
	id: number;
	name: string;
	sort_name: string;
	volume: number;
	year_began: number;
	year_end: number | null;
	issue_count: number;
	publisher: MetronPublisher;
	series_type: MetronSeriesType;
	image: string;
	modified: string;
	resource_url: string;
}

export interface MetronSeriesDetail extends MetronSeries {
	desc: string | null;
	genres: MetronGenre[];
	associated: MetronAssociatedSeries[];
}

export interface MetronGenre {
	id: number;
	name: string;
}

export interface MetronAssociatedSeries {
	id: number;
	name: string;
}

// ============================================
// Issue Types
// ============================================

export interface MetronSeriesRef {
	id: number;
	name: string;
}

export interface MetronIssue {
	id: number;
	issueNumber: string; // API field: "number"
	cover_date: string;
	store_date: string | null;
	image: string;
	cover_hash: string;
	series: MetronSeriesRef;
	modified: string;
	resource_url: string;
}

export interface MetronIssueDetail extends MetronIssue {
	title: string | null;
	desc: string | null;
	upc: string | null;
	sku: string | null;
	isbn: string | null;
	price: string | null;
	page_count: number | null;
	rating: MetronRating;
	credits: MetronCredit[];
	characters: MetronCharacter[];
	teams: MetronTeam[];
	arcs: MetronArc[];
	reprints: MetronReprint[];
	variants: MetronVariant[];
	cv_id: number | null;
	gcd_id: number | null;
}

export interface MetronRating {
	id: number;
	name: string;
}

export interface MetronCredit {
	id: number;
	creator: string;
	role: string[];
}

export interface MetronCharacter {
	id: number;
	name: string;
}

export interface MetronTeam {
	id: number;
	name: string;
}

export interface MetronArc {
	id: number;
	name: string;
}

export interface MetronReprint {
	id: number;
	issue: string;
}

export interface MetronVariant {
	name: string;
	sku: string | null;
	upc: string | null;
	image: string;
}

// ============================================
// Search/List Response Types
// ============================================

export interface MetronPaginatedResponse<T> {
	count: number;
	next: string | null;
	previous: string | null;
	results: T[];
}

export type MetronSeriesSearchResult = MetronPaginatedResponse<MetronSeries>;
export type MetronIssueSearchResult = MetronPaginatedResponse<MetronIssue>;

// ============================================
// Scoring Types
// ============================================

export interface ScoredMetronMatch {
	issue: MetronIssueDetail;
	series: MetronSeries;
	score: number;
	nameMatchScore?: number;
	seriesMatchScore?: number;
}

export interface MetronScorerConfig {
	searchParams: {
		name: string;
		issueNumber?: string; // API field: "number"
		year?: string;
		subtitle?: string;
	};
}

export interface MetronVolumeSearchParams {
	scorerConfiguration: MetronScorerConfig;
	rawFileDetails?: {
		name: string;
		containedIn: string;
		cover?: {
			filePath: string;
		};
	};
}

export interface MetronVolumeSearchResult {
	finalMatches: ScoredMetronMatch[];
	rawFileDetails: MetronVolumeSearchParams["rawFileDetails"];
	scorerConfiguration: MetronScorerConfig;
}

// ============================================
// Rate Limiting Types
// ============================================

export interface RateLimitState {
	burstLimit: number;
	burstRemaining: number;
	burstReset: number;
	sustainedLimit: number;
	sustainedRemaining: number;
	sustainedReset: number;
}

export interface CachedResource {
	data: unknown;
	lastModified: string;
	cachedAt: number;
}

// ============================================
// Error Types
// ============================================

export interface MetronErrorResponse {
	detail: string;
}

export const METRON_ERROR_CODES = {
	AUTH_MISSING: "METRON_AUTH_MISSING",
	AUTH_FAILED: "METRON_AUTH_FAILED",
	RATE_LIMITED: "METRON_RATE_LIMITED",
	NOT_FOUND: "METRON_NOT_FOUND",
	API_ERROR: "METRON_API_ERROR",
	TIMEOUT: "METRON_TIMEOUT",
	UNKNOWN: "METRON_UNKNOWN_ERROR",
} as const;

export type MetronErrorCode = (typeof METRON_ERROR_CODES)[keyof typeof METRON_ERROR_CODES];

// ============================================
// Action Parameter Types
// ============================================

export interface SearchSeriesParams {
	name: string;
	page?: number;
}

export interface GetSeriesByIdParams {
	id: number;
}

export interface SearchIssuesParams {
	series_id?: number;
	series_name?: string;
	issueNumber?: string; // API field: "number"
	cover_year?: number;
	cover_month?: number;
	store_date_range_after?: string;
	store_date_range_before?: string;
	modified_gt?: string;
	page?: number;
}

export interface GetIssueByIdParams {
	id: number;
}

// ============================================
// Socket Event Types
// ============================================

export type MetronScrapingStage =
	| "fetching_series"
	| "ranking_series"
	| "searching_issues"
	| "fetching_details"
	| "scoring_matches"
	| "complete"
	| "error";

export interface MetronScrapingStatus {
	message: string;
	stage: MetronScrapingStage;
	error?: {
		code: string | number;
		context: string;
		retryable: boolean;
		retryAfter?: string;
	};
}
