/**
 * GCD Test Data Fixtures
 *
 * Provides mock data for testing GCD service functionality.
 */

import {
	GCDPublisher,
	GCDSeries,
	GCDIssue,
	GCDStory,
	ScoredGCDMatch,
	GCDScorerConfig,
} from "../../types/gcd.types";

// ============================================
// Publisher Fixtures
// ============================================

/* eslint-disable camelcase */

export const mockPublisher: GCDPublisher = {
	id: 1,
	name: "DC Comics",
	country_id: 225,
	year_began: 1934,
	year_ended: null,
	url: "https://www.dccomics.com",
};

export const mockPublisher2: GCDPublisher = {
	id: 2,
	name: "Marvel Comics",
	country_id: 225,
	year_began: 1939,
	year_ended: null,
	url: "https://www.marvel.com",
};

// ============================================
// Series Fixtures
// ============================================

export const mockSeries: GCDSeries = {
	id: 100,
	name: "Batman",
	sort_name: "Batman",
	year_began: 1940,
	year_ended: 2011,
	issue_count: 713,
	publisher_id: 1,
	notes: "The original Batman series",
	publishing_format: "standard format",
	publisher: mockPublisher,
};

export const mockSeries2: GCDSeries = {
	id: 101,
	name: "Batman: The Dark Knight",
	sort_name: "Batman The Dark Knight",
	year_began: 2011,
	year_ended: 2014,
	issue_count: 29,
	publisher_id: 1,
	notes: "New 52 Batman series",
	publishing_format: "standard format",
	publisher: mockPublisher,
};

export const mockSeries3: GCDSeries = {
	id: 200,
	name: "Spider-Man",
	sort_name: "Spider-Man",
	year_began: 1990,
	year_ended: 1998,
	issue_count: 98,
	publisher_id: 2,
	notes: "Adjectiveless Spider-Man series",
	publishing_format: "standard format",
	publisher: mockPublisher2,
};

export const mockSeriesArray: GCDSeries[] = [
	mockSeries,
	mockSeries2,
	mockSeries3,
];

// ============================================
// Issue Fixtures
// ============================================

export const mockIssue: GCDIssue = {
	id: 1000,
	issueNumber: "1",
	series_id: 100,
	publication_date: "Spring 1940",
	key_date: "1940-03-01",
	price: "10c",
	page_count: 64,
	barcode: null,
	isbn: null,
	variant_of_id: null,
	variant_name: null,
	notes: "First appearance of Batman",
	series: mockSeries,
};

export const mockIssue2: GCDIssue = {
	id: 1001,
	issueNumber: "2",
	series_id: 100,
	publication_date: "Summer 1940",
	key_date: "1940-06-01",
	price: "10c",
	page_count: 64,
	barcode: null,
	isbn: null,
	variant_of_id: null,
	variant_name: null,
	notes: null,
	series: mockSeries,
};

export const mockVariantIssue: GCDIssue = {
	id: 1002,
	issueNumber: "1",
	series_id: 100,
	publication_date: "Spring 1940",
	key_date: "1940-03-01",
	price: "10c",
	page_count: 64,
	barcode: null,
	isbn: null,
	variant_of_id: 1000,
	variant_name: "Variant cover edition",
	notes: "Variant cover",
	series: mockSeries,
};

export const mockIssueWithModernData: GCDIssue = {
	id: 2000,
	issueNumber: "1",
	series_id: 101,
	publication_date: "November 2011",
	key_date: "2011-11-01",
	price: "$2.99",
	page_count: 32,
	barcode: "75960606710200111",
	isbn: null,
	variant_of_id: null,
	variant_name: null,
	notes: "New 52 launch issue",
	series: mockSeries2,
};

export const mockIssueArray: GCDIssue[] = [
	mockIssue,
	mockIssue2,
	mockVariantIssue,
	mockIssueWithModernData,
];

// ============================================
// Story Fixtures
// ============================================

export const mockStory: GCDStory = {
	id: 10000,
	title: "The Case of the Chemical Syndicate",
	type_id: 19, // Comic story
	sequence_number: 0,
	issue_id: 1000,
	page_count: 6,
	synopsis: "Batman solves his first case",
	characters: "Batman; Commissioner Gordon",
};

export const mockStory2: GCDStory = {
	id: 10001,
	title: "The Batman Wars Against the Dirigible of Doom",
	type_id: 19,
	sequence_number: 1,
	issue_id: 1000,
	page_count: 8,
	synopsis: null,
	characters: "Batman; Robin",
};

export const mockCoverStory: GCDStory = {
	id: 9999,
	title: null,
	type_id: 6, // Cover
	sequence_number: 0,
	issue_id: 1000,
	page_count: 1,
	synopsis: null,
	characters: null,
};

export const mockStoryArray: GCDStory[] = [
	mockCoverStory,
	mockStory,
	mockStory2,
];

// ============================================
// Scorer Configuration Fixtures
// ============================================

export const mockScorerConfig: GCDScorerConfig = {
	searchParams: {
		name: "Batman",
		issueNumber: "1",
		year: "1940",
	},
};

export const mockScorerConfigWithPublisher: GCDScorerConfig = {
	searchParams: {
		name: "Batman",
		issueNumber: "1",
		year: "1940",
		publisher: "DC Comics",
	},
};

export const mockScorerConfigNoYear: GCDScorerConfig = {
	searchParams: {
		name: "Batman",
		issueNumber: "1",
	},
};

export const mockScorerConfigNoIssue: GCDScorerConfig = {
	searchParams: {
		name: "Spider-Man",
		year: "1990",
	},
};

// ============================================
// Scored Match Fixtures
// ============================================

export const mockScoredMatch: ScoredGCDMatch = {
	issue: mockIssue,
	series: mockSeries,
	score: 95,
	nameMatchScore: 100,
	issueNumberScore: 100,
	yearScore: 85,
};

export const mockScoredMatch2: ScoredGCDMatch = {
	issue: mockIssue2,
	series: mockSeries,
	score: 70,
	nameMatchScore: 100,
	issueNumberScore: 50,
	yearScore: 85,
};

export const mockScoredMatchArray: ScoredGCDMatch[] = [
	mockScoredMatch,
	mockScoredMatch2,
];

/* eslint-enable camelcase */

// ============================================
// Database Row Fixtures (raw SQLite rows)
// ============================================

export const mockSeriesRow = {
	id: 100,
	name: "Batman",
	sort_name: "Batman",
	year_began: 1940,
	year_ended: 2011,
	issue_count: 713,
	publisher_id: 1,
	notes: "The original Batman series",
	publishing_format: "standard format",
	pub_id: 1,
	pub_name: "DC Comics",
	pub_year_began: 1934,
};

export const mockIssueRow = {
	id: 1000,
	number: "1",
	series_id: 100,
	publication_date: "Spring 1940",
	key_date: "1940-03-01",
	price: "10c",
	page_count: 64,
	barcode: null,
	isbn: null,
	variant_of_id: null,
	variant_name: null,
	notes: "First appearance of Batman",
	series_name: "Batman",
	year_began: 1940,
};

export const mockStoryRow = {
	id: 10000,
	title: "The Case of the Chemical Syndicate",
	type_id: 19,
	sequence_number: 0,
	issue_id: 1000,
	page_count: 6,
	synopsis: "Batman solves his first case",
	characters: "Batman; Commissioner Gordon",
};
