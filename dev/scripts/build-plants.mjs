#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";

const SECTION_COLUMNS = {
  "Non-Specific Taxa": ["scientificName", "commonName"],
  "Master Flora": ["scientificName", "commonName", "status"]
};

const [inputPath = "data/SurveyPlantList.tsv", outputPath = "data/plants.json",
  dioeciousPath = "data/dioecious"] = process.argv.slice(2);

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
  // The separate list may include its section title and column header.
  const dioeciousNames = new Set();
  for (const [index, row] of parseTsv(normalizeText(readFileSync(dioeciousPath, "utf8"))).entries()) {
    if (isBlankRow(row)) continue;
    const name = normalizeField(index + 1, "dioecious commonName", row[0]);
    if (name === "Dioecious Plants" || name === "commonName") continue;
    if (row.slice(1).some(value => value.trim() !== ""))
      fail(`${dioeciousPath} row ${index + 1}: expected one common name`);
    if (dioeciousNames.has(name))
      fail(`${dioeciousPath} row ${index + 1}: duplicate name ${JSON.stringify(name)}`);
    dioeciousNames.add(name);
  }
  if (!dioeciousNames.size) fail("Dioecious list is empty");

  const rows = parseTsv(normalizeText(readFileSync(inputPath, "utf8")));
  const matchedDioecious = new Set();
  const sections = new Set();
  let section = null;
  let indexes = null;
  const species = [];
  const seenCommonNames = new Set();

  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    if (isBlankRow(row)) return;
    const title = row[0].trim();
    if (Object.hasOwn(SECTION_COLUMNS, title) && row.slice(1).every(value => value.trim() === "")) {
      if (sections.has(title)) fail(`row ${rowNumber}: duplicate section ${title}`);
      if (section && !indexes) fail(`Missing column header for ${section}`);
      section = title;
      sections.add(title);
      indexes = null;
      return;
    }
    if (!section) fail(`row ${rowNumber}: expected a section title`);
    if (!indexes) {
      indexes = columnIndexes(row.map(value => value.trim()), SECTION_COLUMNS[section]);
      return;
    }
    // A final spreadsheet status-count footer has no plant names.
    if (section === "Master Flora" &&
        field(row, indexes.scientificName).trim() === "" &&
        field(row, indexes.commonName).trim() === "" &&
        /^\d+$/.test(field(row, indexes.status).trim()) &&
        rows.slice(index + 1).every(isBlankRow)) {
      warn(rowNumber, "ignored trailing status-count total");
      return;
    }
    report.inputRows++;
    const commonName = normalizeField(rowNumber, "commonName",
      field(row, indexes.commonName));
    const scientificName = normalizeField(rowNumber, "scientificName",
      field(row, indexes.scientificName));
    const status = normalizeField(rowNumber, "status",
      field(row, indexes.status));
    validateRow({ rowNumber, commonName, scientificName, status });

    addSpecies(species, seenCommonNames, {
      rowNumber,
      commonName,
      scientificName,
      status
    });

    if (dioeciousNames.has(commonName)) {
      matchedDioecious.add(commonName);
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

  for (const title of Object.keys(SECTION_COLUMNS)) {
    if (!sections.has(title)) fail(`Missing section: ${title}`);
  }
  if (!indexes) fail(`Missing column header for ${section}`);
  for (const name of dioeciousNames) {
    if (!matchedDioecious.has(name))
      report.errors.push(`${dioeciousPath}: no plant matches ${JSON.stringify(name)}`);
  }

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
  return row.every(value => value.trim() === "");
}

function validateRow({ rowNumber, commonName, scientificName, status }) {
  requireCleanField(rowNumber, "commonName", commonName);
  requireCleanField(rowNumber, "scientificName", scientificName);

  if (status !== "" && /\d/.test(status))
    error(rowNumber, `status contains a digit: ${JSON.stringify(status)}`);
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
