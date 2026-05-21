# Function to turn an object's keys/values into text lines
def labeled_block(name):
  "--- \(name) ---", (to_entries[] | "\(.key): \(.value)"), "";

(
  # 1. Metadata
  (.meta | labeled_block("METADATA")),

  # 2. Start Note
  "START NOTE:", .startNote, "",

  # 3. Trails Loop
  (.trails | to_entries[] | (
    "TRAIL: \(.key)",
    "Note: \(.value.note)",
    "Entries:",
    # Check if the FIRST entry in the array is an object
    (.value.entries | if (.[0] | type) == "object" 
      then 
        # Capture unsorted keys from the first item to use as a template
        (.[0] | keys_unsorted) as $cols | 
        ($cols | @csv),                 # Output the Header Row
        (.[] | [.[$cols[]]] | @csv)     # Map every row to those exact keys
      else 
        "Entry Value", (.[] | [.] | @csv) 
      end),
    ""
  )),

  # 4. End Note
  "END NOTE:", .endNote
)

