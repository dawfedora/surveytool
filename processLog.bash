#!/bin/bash

base=$(basename "$1" .json)

jq -r -f processLog.jq  $1 > $base.csv
