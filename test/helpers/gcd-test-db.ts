/**
 * GCD Test Database Helper
 *
 * Utilities for creating in-memory SQLite databases for testing.
 * Uses better-sqlite3 to create test databases with the GCD schema.
 */

import {
	mockPublisher,
	mockPublisher2,
	mockSeries,
	mockSeries2,
	mockSeries3,
	mockIssue,
	mockIssue2,
	mockVariantIssue,
	mockIssueWithModernData,
	mockStory,
	mockStory2,
	mockCoverStory,
} from "../fixtures/gcd-test-data";

// Type for better-sqlite3 Database instance
// eslint-disable-next-line @typescript-eslint/no-require-imports
type BetterSqlite3Database = ReturnType<typeof require>;

/**
 * Creates an in-memory SQLite database with GCD schema.
 * For use in unit tests.
 *
 * @returns {BetterSqlite3Database} An in-memory database instance
 */
export const createTestDatabase = (): BetterSqlite3Database => {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const Database = require("better-sqlite3");
	const db = new Database(":memory:");

	// Create GCD tables
	db.exec(`
		CREATE TABLE gcd_publisher (
			id INTEGER PRIMARY KEY,
			name TEXT NOT NULL,
			country_id INTEGER,
			year_began INTEGER,
			year_ended INTEGER,
			url TEXT
		);

		CREATE TABLE gcd_series (
			id INTEGER PRIMARY KEY,
			name TEXT NOT NULL,
			sort_name TEXT,
			year_began INTEGER,
			year_ended INTEGER,
			issue_count INTEGER DEFAULT 0,
			publisher_id INTEGER,
			notes TEXT,
			publishing_format TEXT,
			FOREIGN KEY (publisher_id) REFERENCES gcd_publisher(id)
		);

		CREATE TABLE gcd_issue (
			id INTEGER PRIMARY KEY,
			number TEXT NOT NULL,
			series_id INTEGER NOT NULL,
			publication_date TEXT,
			key_date TEXT,
			price TEXT,
			page_count INTEGER,
			barcode TEXT,
			isbn TEXT,
			variant_of_id INTEGER,
			variant_name TEXT,
			notes TEXT,
			FOREIGN KEY (series_id) REFERENCES gcd_series(id),
			FOREIGN KEY (variant_of_id) REFERENCES gcd_issue(id)
		);

		CREATE TABLE gcd_story (
			id INTEGER PRIMARY KEY,
			title TEXT,
			type_id INTEGER NOT NULL,
			sequence_number INTEGER NOT NULL,
			issue_id INTEGER NOT NULL,
			page_count INTEGER,
			synopsis TEXT,
			characters TEXT,
			FOREIGN KEY (issue_id) REFERENCES gcd_issue(id)
		);

		CREATE INDEX idx_series_name ON gcd_series(name);
		CREATE INDEX idx_issue_series ON gcd_issue(series_id);
		CREATE INDEX idx_issue_number ON gcd_issue(number);
		CREATE INDEX idx_story_issue ON gcd_story(issue_id);
	`);

	return db;
};

/**
 * Seeds the test database with standard fixture data.
 *
 * @param {BetterSqlite3Database} db - The database to seed
 */
export const seedTestDatabase = (db: BetterSqlite3Database): void => {
	/* eslint-disable camelcase */

	// Insert publishers
	const insertPublisher = db.prepare(`
		INSERT INTO gcd_publisher (id, name, country_id, year_began, year_ended, url)
		VALUES (?, ?, ?, ?, ?, ?)
	`);

	insertPublisher.run(
		mockPublisher.id,
		mockPublisher.name,
		mockPublisher.country_id,
		mockPublisher.year_began,
		mockPublisher.year_ended,
		mockPublisher.url
	);
	insertPublisher.run(
		mockPublisher2.id,
		mockPublisher2.name,
		mockPublisher2.country_id,
		mockPublisher2.year_began,
		mockPublisher2.year_ended,
		mockPublisher2.url
	);

	// Insert series
	const insertSeries = db.prepare(`
		INSERT INTO gcd_series (id, name, sort_name, year_began, year_ended, issue_count, publisher_id, notes, publishing_format)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`);

	for (const series of [mockSeries, mockSeries2, mockSeries3]) {
		insertSeries.run(
			series.id,
			series.name,
			series.sort_name,
			series.year_began,
			series.year_ended,
			series.issue_count,
			series.publisher_id,
			series.notes,
			series.publishing_format
		);
	}

	// Insert issues
	const insertIssue = db.prepare(`
		INSERT INTO gcd_issue (id, number, series_id, publication_date, key_date, price, page_count, barcode, isbn, variant_of_id, variant_name, notes)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`);

	for (const issue of [mockIssue, mockIssue2, mockVariantIssue, mockIssueWithModernData]) {
		insertIssue.run(
			issue.id,
			issue.issueNumber,
			issue.series_id,
			issue.publication_date,
			issue.key_date,
			issue.price,
			issue.page_count,
			issue.barcode,
			issue.isbn,
			issue.variant_of_id,
			issue.variant_name,
			issue.notes
		);
	}

	// Insert stories
	const insertStory = db.prepare(`
		INSERT INTO gcd_story (id, title, type_id, sequence_number, issue_id, page_count, synopsis, characters)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`);

	for (const story of [mockCoverStory, mockStory, mockStory2]) {
		insertStory.run(
			story.id,
			story.title,
			story.type_id,
			story.sequence_number,
			story.issue_id,
			story.page_count,
			story.synopsis,
			story.characters
		);
	}

	/* eslint-enable camelcase */
};

/**
 * Creates and seeds a test database in one call.
 *
 * @returns {BetterSqlite3Database} A seeded in-memory database
 */
export const createSeededTestDatabase = (): BetterSqlite3Database => {
	const db = createTestDatabase();
	seedTestDatabase(db);
	return db;
};

/**
 * Creates a mock broker for testing service actions.
 *
 * @returns {object} A mock Moleculer broker
 */
export const createMockBroker = (): object => ({
	call: jest.fn(),
	logger: {
		info: jest.fn(),
		warn: jest.fn(),
		error: jest.fn(),
		debug: jest.fn(),
	},
});

/**
 * Creates a mock context for testing service actions.
 *
 * @param {Record<string, unknown>} params - Action parameters
 * @returns {object} A mock Moleculer context
 */
export const createMockContext = (params: Record<string, unknown> = {}): object => ({
	params,
	meta: {},
	broker: createMockBroker(),
});
