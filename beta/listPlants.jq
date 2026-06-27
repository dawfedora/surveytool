# Split rows and clean data
split("\n") | .[:-1] | map(split("\t")) | 

# Build the species array first as a list of compact strings
(to_entries | map(
  {
    speciesId: (.key + 1),
    scientificName: .value[0],
    commonName: .value[1],
    status: .value[2]
  } | @json # This forces the object onto a single line
)) as $species |

# Construct the final output string
[
  "{",
  "  \"header\": {",
  "    \"version\": \"1.0\",",
  "    \"count\": \"\($species | length)\"",
  "  },",
  "  \"species\": [",
  "    \($species | join(",\n    "))",
  "  ]",
  "}"
] | .[]

