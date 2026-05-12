import { gql } from "graphql-tag";

/**
 * GraphQL Type Definitions for ThreeTwo Metadata Service
 * Covers ComicVine and Metron API endpoints
 */
export const typeDefs = gql`
	# ============================================
	# ComicVine Types
	# ============================================

	# Image URLs for various sizes
	type ImageUrls {
		icon_url: String
		medium_url: String
		screen_url: String
		screen_large_url: String
		small_url: String
		super_url: String
		thumb_url: String
		tiny_url: String
		original_url: String
		image_tags: String
	}

	# Publisher information
	type Publisher {
		id: Int
		name: String
		api_detail_url: String
	}

	# Volume information
	type Volume {
		id: Int!
		name: String!
		api_detail_url: String
		site_detail_url: String
		start_year: String
		publisher: Publisher
		count_of_issues: Int
		image: ImageUrls
		description: String
		deck: String
	}

	# Issue information
	type Issue {
		id: Int!
		name: String
		issue_number: String
		api_detail_url: String
		site_detail_url: String
		cover_date: String
		store_date: String
		volume: Volume
		image: ImageUrls
		description: String
		person_credits: [PersonCredit!]
		character_credits: [CharacterCredit!]
		team_credits: [TeamCredit!]
		location_credits: [LocationCredit!]
		story_arc_credits: [StoryArcCredit!]
	}

	# Person credit (writer, artist, etc.)
	type PersonCredit {
		id: Int
		name: String
		api_detail_url: String
		site_detail_url: String
		role: String
	}

	# Character credit
	type CharacterCredit {
		id: Int
		name: String
		api_detail_url: String
		site_detail_url: String
	}

	# Team credit
	type TeamCredit {
		id: Int
		name: String
		api_detail_url: String
		site_detail_url: String
	}

	# Location credit
	type LocationCredit {
		id: Int
		name: String
		api_detail_url: String
		site_detail_url: String
	}

	# Story arc credit
	type StoryArcCredit {
		id: Int
		name: String
		api_detail_url: String
		site_detail_url: String
		deck: String
		description: String
		image: ImageUrls
	}

	# ComicVine search result
	type ComicVineSearchResult {
		error: String!
		limit: Int!
		offset: Int!
		number_of_page_results: Int!
		number_of_total_results: Int!
		status_code: Int!
		results: [SearchResultItem!]!
	}

	# Generic search result item (can be volume, issue, etc.)
	type SearchResultItem {
		id: Int
		name: String
		api_detail_url: String
		site_detail_url: String
		image: ImageUrls
		description: String
		deck: String
		# Volume-specific fields
		start_year: String
		publisher: Publisher
		count_of_issues: Int
		# Issue-specific fields
		issue_number: String
		volume: Volume
		cover_date: String
	}

	# Volume-based search result with scoring
	type VolumeSearchResult {
		volume: Volume!
		score: Float
		matchedIssues: [Issue!]
	}

	# Volume-based search response
	type VolumeBasedSearchResponse {
		results: [VolumeSearchResult!]!
		totalResults: Int!
	}

	# Weekly pull list item (from League of Comic Geeks)
	type MetadataPullListItem {
		name: String
		publisher: String
		url: String
		cover: String
		description: String
		price: String
		rating: Float
		pulls: Int
		potw: Int
		publicationDate: String
	}

	# Paginated pull list response
	type MetadataPullListResponse {
		result: [MetadataPullListItem!]!
		meta: MetadataPaginationMeta!
	}

	# Pagination metadata
	type MetadataPaginationMeta {
		currentPage: Int!
		totalPages: Int!
		pageSize: Int!
		totalCount: Int!
		hasNextPage: Boolean!
		hasPreviousPage: Boolean!
	}

	# Story arc with enriched data
	type StoryArc {
		id: Int!
		name: String!
		deck: String
		description: String
		image: ImageUrls
		issues: [Issue!]
	}

	# Generic ComicVine resource response
	type ComicVineResourceResponse {
		error: String!
		limit: Int!
		offset: Int!
		number_of_page_results: Int!
		number_of_total_results: Int!
		status_code: Int!
		results: [SearchResultItem!]!
	}

	# Volume detail response
	type VolumeDetailResponse {
		error: String!
		status_code: Int!
		results: Volume!
	}

	# Issues for series response
	type IssuesForSeriesResponse {
		error: String!
		limit: Int!
		offset: Int!
		number_of_page_results: Int!
		number_of_total_results: Int!
		status_code: Int!
		results: [Issue!]!
	}

	# ============================================
	# Metron Types
	# ============================================

	# Generic Metron resource (flexible JSON response)
	scalar JSON

	# Legacy Metron response (for backward compatibility)
	type MetronResponse {
		data: JSON
		status: Int!
	}

	# Metron Publisher
	type MetronPublisher {
		id: Int!
		name: String!
	}

	# Metron Series Type (e.g., "Ongoing", "Limited", "One-Shot")
	type MetronSeriesType {
		id: Int!
		name: String!
	}

	# Metron Genre
	type MetronGenre {
		id: Int!
		name: String!
	}

	# Metron Associated Series (for crossovers, spin-offs, etc.)
	type MetronAssociatedSeries {
		id: Int!
		name: String!
	}

	# Metron Series
	type MetronSeries {
		id: Int!
		name: String!
		sort_name: String
		volume: Int
		year_began: Int
		year_end: Int
		issue_count: Int
		publisher: MetronPublisher
		series_type: MetronSeriesType
		image: String
		modified: String
		resource_url: String
	}

	# Metron Series Detail (extended information)
	type MetronSeriesDetail {
		id: Int!
		name: String!
		sort_name: String
		volume: Int
		year_began: Int
		year_end: Int
		issue_count: Int
		publisher: MetronPublisher
		series_type: MetronSeriesType
		image: String
		modified: String
		resource_url: String
		desc: String
		genres: [MetronGenre!]
		associated: [MetronAssociatedSeries!]
	}

	# Metron Series Reference (minimal info for issue responses)
	type MetronSeriesRef {
		id: Int!
		name: String!
	}

	# Metron Issue
	type MetronIssue {
		id: Int!
		issueNumber: String!
		cover_date: String
		store_date: String
		image: String
		cover_hash: String
		series: MetronSeriesRef
		modified: String
		resource_url: String
	}

	# Metron Rating
	type MetronRating {
		id: Int!
		name: String!
	}

	# Metron Credit (creator with roles)
	type MetronCredit {
		id: Int!
		creator: String!
		role: [String!]
	}

	# Metron Character
	type MetronCharacter {
		id: Int!
		name: String!
	}

	# Metron Team
	type MetronTeam {
		id: Int!
		name: String!
	}

	# Metron Arc (story arc)
	type MetronArc {
		id: Int!
		name: String!
	}

	# Metron Reprint
	type MetronReprint {
		id: Int!
		issue: String!
	}

	# Metron Variant Cover
	type MetronVariant {
		name: String
		sku: String
		upc: String
		image: String
	}

	# Metron Issue Detail (full issue information)
	type MetronIssueDetail {
		id: Int!
		issueNumber: String!
		cover_date: String
		store_date: String
		image: String
		cover_hash: String
		series: MetronSeriesRef
		modified: String
		resource_url: String
		title: String
		desc: String
		upc: String
		sku: String
		isbn: String
		price: String
		page_count: Int
		rating: MetronRating
		credits: [MetronCredit!]
		characters: [MetronCharacter!]
		teams: [MetronTeam!]
		arcs: [MetronArc!]
		reprints: [MetronReprint!]
		variants: [MetronVariant!]
		cv_id: Int
		gcd_id: Int
	}

	# Metron Series Search Result (paginated)
	type MetronSeriesSearchResult {
		count: Int!
		next: String
		previous: String
		results: [MetronSeries!]!
	}

	# Metron Issue Search Result (paginated)
	type MetronIssueSearchResult {
		count: Int!
		next: String
		previous: String
		results: [MetronIssue!]!
	}

	# Scored Metron Match (for volumeBasedSearch)
	type ScoredMetronMatch {
		issue: MetronIssueDetail!
		series: MetronSeries!
		score: Float!
		nameMatchScore: Float
		seriesMatchScore: Float
	}

	# Metron Volume-Based Search Result
	type MetronVolumeSearchResult {
		finalMatches: [ScoredMetronMatch!]!
		rawFileDetails: JSON
		scorerConfiguration: JSON
	}

	# Metron Rate Limit State
	type MetronRateLimitState {
		burstLimit: Int
		burstRemaining: Int
		burstReset: Int
		sustainedLimit: Int
		sustainedRemaining: Int
		sustainedReset: Int
	}

	# Metron Health Check Response
	type MetronHealthResponse {
		status: String!
		configured: Boolean!
		rateLimit: MetronRateLimitState
	}

	# ============================================
	# Input Types
	# ============================================

	# Search parameters
	input SearchInput {
		query: String!
		resources: String!
		format: String
		sort: String
		field_list: String
		limit: Int
		offset: Int
	}

	# Volume-based search configuration
	input VolumeSearchInput {
		query: String!
		resources: String!
		format: String
		limit: Int
		offset: Int
		fieldList: String
		scorerConfiguration: ScorerConfigurationInput
		rawFileDetails: JSON
	}

	# Scorer configuration for matching
	input ScorerConfigurationInput {
		searchParams: SearchParamsInput
	}

	# Search parameters for scoring
	input SearchParamsInput {
		name: String
		number: String
		year: String
		volume: String
	}

	# Get volumes input
	input GetVolumesInput {
		volumeURI: String!
		fieldList: String
	}

	# Get resource input
	input GetResourceInput {
		resources: String!
		filter: String
		fieldList: String
	}

	# Weekly pull list input
	input WeeklyPullListInput {
		startDate: String!
		currentPage: Int!
		pageSize: Int!
	}

	# Metron fetch resource input (legacy)
	input MetronFetchInput {
		resource: String!
		method: String!
		query: String
	}

	# Metron series search input
	input MetronSeriesSearchInput {
		name: String!
		page: Int
	}

	# Metron issue search input
	input MetronIssueSearchInput {
		series_id: Int
		series_name: String
		issueNumber: String
		cover_year: Int
		cover_month: Int
		page: Int
	}

	# Metron volume-based search configuration
	input MetronScorerConfigInput {
		searchParams: MetronSearchParamsInput!
	}

	# Metron search parameters for scoring
	input MetronSearchParamsInput {
		name: String!
		issueNumber: String
		year: String
		subtitle: String
	}

	# Metron volume-based search input
	input MetronVolumeSearchInput {
		scorerConfiguration: MetronScorerConfigInput!
		rawFileDetails: JSON
	}

	# Apply Metron metadata input
	input ApplyMetronMetadataInput {
		"""
		MongoDB ObjectId of the comic book to update
		"""
		comicObjectId: ID!
		"""
		Metron issue ID to apply metadata from
		"""
		metronIssueId: Int!
		"""
		Metron series ID for series information
		"""
		metronSeriesId: Int!
	}

	# Apply metadata response
	type ApplyMetadataResponse {
		success: Boolean!
		message: String
		comicObjectId: ID
		updatedAt: String
	}

	# ============================================
	# Queries
	# ============================================

	type Query {
		"""
		Search ComicVine for volumes, issues, characters, etc.
		"""
		searchComicVine(input: SearchInput!): ComicVineSearchResult!

		"""
		Advanced volume-based search with scoring and filtering
		"""
		volumeBasedSearch(input: VolumeSearchInput!): VolumeBasedSearchResponse!

		"""
		Get volume details by URI
		"""
		getVolume(input: GetVolumesInput!): VolumeDetailResponse!

		"""
		Get all issues for a series by comic object ID
		"""
		getIssuesForSeries(comicObjectId: ID!): IssuesForSeriesResponse!

		"""
		Get generic ComicVine resource (issues, volumes, etc.)
		"""
		getComicVineResource(input: GetResourceInput!): ComicVineResourceResponse!

		"""
		Get story arcs for a volume
		"""
		getStoryArcs(volumeId: Int!): [StoryArc!]!

		"""
		Get weekly pull list from League of Comic Geeks
		"""
		getWeeklyPullList(input: WeeklyPullListInput!): MetadataPullListResponse!

		"""
		Fetch resource from Metron API (legacy)
		"""
		fetchMetronResource(input: MetronFetchInput!): MetronResponse!

		# ============================================
		# Metron Queries
		# ============================================

		"""
		Check Metron service health and configuration status
		"""
		metronHealth: MetronHealthResponse!

		"""
		Search Metron for series by name
		"""
		searchMetronSeries(input: MetronSeriesSearchInput!): MetronSeriesSearchResult!

		"""
		Get Metron series details by ID
		"""
		getMetronSeriesById(id: Int!): MetronSeriesDetail!

		"""
		Search Metron for issues with filters
		"""
		searchMetronIssues(input: MetronIssueSearchInput!): MetronIssueSearchResult!

		"""
		Get Metron issue details by ID
		"""
		getMetronIssueById(id: Int!): MetronIssueDetail!

		"""
		Advanced volume-based search with scoring (mirrors ComicVine volumeBasedSearch)
		"""
		metronVolumeBasedSearch(input: MetronVolumeSearchInput!): MetronVolumeSearchResult!
	}

	# ============================================
	# Mutations
	# ============================================

	type Mutation {
		"""
		Placeholder for future mutations
		"""
		_empty: String

		"""
		Apply Metron metadata to a comic book in the library.
		This fetches the issue and series details from Metron and stores them
		in the comic's sourcedMetadata.metron field.
		"""
		applyMetronMetadata(input: ApplyMetronMetadataInput!): ApplyMetadataResponse!
	}
`;
