#!/bin/bash

INPUT=$1
OUTPUT="${INPUT%.*}.tsv"

jq -r -f processLog.jq  $INPUT > $OUTPUT
