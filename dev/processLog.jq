# 1. Output the Start and End Notes
"START NOTE:", .startNote, 
"END NOTE:", .endNote,
"",

# 2. Trail Notes Section
"TRAIL NOTES:",
(.trails | to_entries[] | 
  [
    .key, 
    (.value.notes | gsub("\n"; "; ")) # Replaces newlines with semicolons
  ] | @tsv
),
"",

# 3. Prepare the Columnar Trails
(
  [ .trails | to_entries[] | {
      name: .key, 
      # Extract ONLY the "Common Name" field from each entry
      items: [ .value.entries[] | ."commonName" // "" ]
    }
  ] as $cols |
  
  # Find the longest trail list to determine row count
  ($cols | map(.items | length) | max) as $max_rows |

  # Output the Header Row (Trail Names)
  ([$cols[].name] | @tsv),

  # Output the Data Rows (Common Names only)
  range(0; $max_rows) as $i |
  ([$cols[] | .items[$i] // ""] | @tsv)
)

