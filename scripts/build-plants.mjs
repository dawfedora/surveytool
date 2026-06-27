#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";

const REQUIRED_COLUMNS = [
  "commonName",
  "scientificName",
  "status",
  "dioecious"
];

const [inputPath = "SurveyPlantList.tsv", outputPath = "plants.json"] =
  process.argv.slice(2);

const report = {
  inputPath,
  outputPath,
  inputRows: 0,
  outputRows: 0,
  dioeciousRows: 0,
  warnings: [],
  errors: []
};

try {
  const text = normalizeText(readFileSync(inputPath, "utf8"));
  const rows = parseTsv(text);

  if (rows.length === 0)
    fail("Input TSV is empty");

  const header = rows[0];
  const indexes = columnIndexes(header, REQUIRED_COLUMNS);
  const sourceRows = rows.slice(1);
  const species = [];
  const seenCommonNames = new Set();

  report.inputRows = sourceRows.length;

  sourceRows.forEach((row, index) => {
    const rowNumber = index + 2; // header is row 1

    if (isBlankRow(row))
      return;
 
    const commonName = normalizeField(rowNumber, "commonName",
      field(row, indexes.commonName));
    const scientificName = normalizeField(rowNumber, "scientificName",
      field(row, indexes.scientificName));
    const status = normalizeField(rowNumber, "status",
      field(row, indexes.status));
    const dioecious = normalizeField(rowNumber, "dioecious",
      field(row, indexes.dioecious));

    validateRow({ rowNumber, commonName, scientificName, status, dioecious });

    addSpecies(species, seenCommonNames, {
      rowNumber,
      commonName,
      scientificName,
      status
    });

    if (dioecious === "D") {
      report.dioeciousRows++;
      addSpecies(species, seenCommonNames, {
        rowNumber,
        commonName: `${commonName} (m)`,
        scientificName,
        status
      });
      addSpecies(species, seenCommonNames, {
        rowNumber,
        commonName: `${commonName} (f)`,
        scientificName,
        status
      });
    }
  });

  if (report.errors.length) {
    printReport(report);
    process.exitCode = 1;
  } else {
    sortSpeciesByCommonName(species);
    report.outputRows = species.length;
    writeFileSync(outputPath, formatPlantsJson(species));
    printReport(report);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

function normalizeField(rowNumber, name, value) {
  const normalized = value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized !== value)
    warn(rowNumber, `${name} normalized whitespace: ${JSON.stringify(value)} -> ${JSON.stringify(normalized)}`);

  return normalized;
}

function formatPlantsJson(species) {
  const speciesLines = species.map(item => `    ${JSON.stringify(item)}`);

  return [
    "{",
    '  "header": {',
    '    "version": "1.0",',
    `    "count": "${species.length}"`,
    "  },",
    '  "species": [',
    speciesLines.join(",\n"),
    "  ]",
    "}",
    ""
  ].join("\n");
}

function sortSpeciesByCommonName(species) {
  species.sort((a, b) =>
    a.commonName.localeCompare(
      b.commonName,
      "en-US",
      { sensitivity: "base" }
    )
  );
}

function normalizeText(text) {
  let normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

  if (!normalized.endsWith("\n"))
    normalized += "\n";

  return normalized;
}

function parseTsv(text) {
  return text
    .split("\n")
    .slice(0, -1)
    .map(line => line.split("\t"));
}

function columnIndexes(header, names) {
  const indexes = {};

  for (const name of names) {
    const index = header.indexOf(name);
    if (index === -1)
      fail(`Missing required TSV header: ${name}`);

    indexes[name] = index;
  }

  return indexes;
}

function field(row, index) {
  return row[index] ?? "";
}

function isBlankRow(row) {
  return row.every(value => value === "");
}

function validateRow({ rowNumber, commonName, scientificName, status, dioecious }) {
  requireCleanField(rowNumber, "commonName", commonName);
  requireCleanField(rowNumber, "scientificName", scientificName);

  if (status !== "" && /\d/.test(status))
    error(rowNumber, `status contains a digit: ${JSON.stringify(status)}`);

  if (dioecious !== "" && dioecious !== "D")
    error(rowNumber, `dioecious must be blank or "D": ${JSON.stringify(dioecious)}`);
}

function requireCleanField(rowNumber, name, value) {
  if (value === "") {
    error(rowNumber, `${name} is blank`);
    return;
  }
}

function addSpecies(species, seenCommonNames, item) {
  if (seenCommonNames.has(item.commonName)) {
    error(item.rowNumber, `duplicate emitted commonName: ${JSON.stringify(item.commonName)}`);
    return;
  }

  seenCommonNames.add(item.commonName);

  species.push({
    scientificName: item.scientificName,
    commonName: item.commonName,
    status: item.status
  });
}

function warn(rowNumber, message) {
  report.warnings.push(`row ${rowNumber}: ${message}`);
}

function error(rowNumber, message) {
  report.errors.push(`row ${rowNumber}: ${message}`);
}

function fail(message) {
  throw new Error(message);
}

function printReport(result) {
  console.log(`Read ${result.inputRows} data rows from ${result.inputPath}`);
  console.log(`Generated ${result.outputRows} species rows in ${result.outputPath}`);
  console.log(`Expanded ${result.dioeciousRows} dioecious rows`);

  for (const warning of result.warnings)
    console.warn(`WARNING: ${warning}`);

  for (const problem of result.errors)
    console.error(`ERROR: ${problem}`);
}
