# r2d2

Really Reliable De-Deplucation (<-- stretching!)

This is an experimental block format for IPLD. It leverages the
constraints of the IPLD data model to reduce the bytes required
in the format.

Features:

* fully deterministic
* deduplicates common values (strings and bytes)
* supports the full IPLD data model
* links can be parsed without reading the entire block
* paths can be read without fully parsing most values

Constraints:

* Does not support anything not in the IPLD data model
  * Map keys can only be strings
* Blocks must be written transactionally (no streaming)
* Every serialization must be a single, complete value type

# block structure

```
links | values | structure
```

## table

```
0 - 100 : inline varint
100 : delimiter
101 : varint (100-112 only)
102 : utf8 string reference
103 : bytes reference
104 : null
105 : true
106 : false
107 : float
108 : map
109 : list
110 : cid reference
111 : signed varint
112 : signed float
113+ : inline varint
```

## writing cids

* write the byte representation of every CID
* write null byte

## writing values

* pepare every value
  * recursively parse through the entire object
    * convert all string values and map keys to binary representation
    * collect all binary values
    * de-duplicate every value's binary representation
  * order all values
    * length first, then byte comparison
  * write the increase in length from the prior value (beginning at zero)
  * write the value
* write the length of the prepared values
* write the prepared values

Writing this way enforces deterministic ordering and de-duplication. It
also keeps the encoded length numbers as small as possible, leading
to a smaller varint.

## writing structure

The block stucture is written as a single table entry.

If the root block stucture is a map or list the trailing delimiter (0 for map, 100 for list)
MUST be removed.

### writing table entries

#### writing map value

* write 108
* for every entry in the list
  * write the increase over the previous map key + 1
  * write the table entry for the value
* write a null byte

Writing this way enforces deterministic order of map keys. It
also keeps the encoded index numbers as small as possible, leading
to a smaller varint.

No two map keys can reference the same value index. MUST throw.

#### writing list value

* write 109
* for every value in the list
  * write the table entry
* write 100

#### writing varints

For any whole positive

* If the number is between 100 and 112 write [ 101, varint ]
* For any other number just write the varint

For negative integers:

* write 111
* write the varint

#### writing floats

For positive floats:

* write 107
* write the left side of the decimal as a varint
* write the right side of the decimal as a varint

For negative floats:

* write 112
* write the left side of the decimal as a varint
* write the right side of the decimal as a varint

#### writing constants (null, true, false)

* if null: write 104
* if true: write 105
* if false: write 106

#### writing references (cid, string, bytes)

* if link: write 110 and then the varint index of the link
* if string: write 102 and then the varint index of the value
* if bytes: write 103 and then the varint index of the value

## parsing cids

* parse each cid until null byte

## parsing values

* first varint is the length of the entire values section
* parse each value
  * `read()` varint for increase from prior length (begins at zero)
  * value is written after the varint for the given length (prior length + increase)

## parsing structure

* structure is parsed as a single table entry value
* for map and list entries the final trailing delimiter (0 for map, 100 for list) is removed

### parsing a table entry

We use `read()` to refer to the next read after this varint is read

* < 100 - This varint is the inline number value
* 100 - List delimiter
* 101 - If it's a varint then the next `read()` is the full varint value
* 102 - The next `read()` is a varint for the index of the value and this value is a string value.
* 103 - The next `read()` is a varint for the index of the value and this value is a bytes value.
* 104 - This is null
* 105 - This is true
* 106 - This is false
* 107 - The next two `read()`s are varints parsed into a float value.
  * The first varint is the left side of the decimal value (positive or negative integer)
  * The second varint is the rigth side of the decimal value
    * This means that the decoding rules may need to vary for positive and negative floats,
      as the interpretation of this value is positive when applied to a positive float and
      negative when applied to a negative float
* 108 - All of the following `read()`s are in this `map` until a null byte
  * The first `read()` is a reference to the value index and should be represented by a string key. The index is offset by +1 so that a null byte can be used to end the map.
  * The next `read()` is the map value and is a table entry table entry
  * read these recursively until you hit a null byte
* 109 - All of the following `read()`s are in this `list` until a 100 delimiter
  * Every `read()` is a table entry you hit a 100 delimiter
* 110 - The next `read()` is a varint for the index of the cid value.
* 111 - The next `read(0)` is a signed varint, follow the varint parsing rules but make the value negative
* 112 - The next `read(0)` is a signed float, follow float parsing rules but make the left side negative
* 111 + This varint is the inline number value

## cids and values

```
| ...cids | null byte |
| length | ...values(len | data) |
| structure |
```

## structure

```
| table entry |
| [ 108, ...(string reference varint, table entry) ] | null byte // map
| [ 109, ...(table entry) ] | null byte // list
```

## value and cid sorting algorithm

* only the binary form is stored
* sort length first
* then sort by byte comparison

## map sorting algorithm

* map keys are sorted by their string value reference number
* this means the map sorting naturally corresponds to the value sorting algorithm
