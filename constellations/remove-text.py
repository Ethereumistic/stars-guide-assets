import os
import xml.etree.ElementTree as ET
import re

# Register namespaces to ensure correct output and avoid "ns0" prefixes in output
ET.register_namespace('', "http://www.w3.org/2000/svg")

def remove_text_from_zodiacs(input_folder="inverted_zodiacs", output_folder="final", threshold=2500):
    """
    Removes text from zodiac SVGs by filtering out subpaths 
    located at the bottom of the image (Y < threshold).
    Works on the inverted SVGs where constellation coordinates are accurately positioned.
    """
    if not os.path.exists(output_folder):
        os.makedirs(output_folder)

    if not os.path.exists(input_folder):
        print(f"Error: Input folder '{input_folder}' not found.")
        return

    # This regex identifies subpaths within a 'd' attribute.
    # Each subpath starts with MoveTo (M or m).
    subpath_pattern = re.compile(r'([Mm][^Mm]+)')
    
    # This regex finds the first Y coordinate in a subpath.
    first_y_pattern = re.compile(r'[Mm]\s*(-?\d+\.?\d*)\s*[, \t]\s*(-?\d+\.?\d*)')

    for filename in os.listdir(input_folder):
        if not filename.endswith(".svg"):
            continue
            
        input_path = os.path.join(input_folder, filename)
        try:
            tree = ET.parse(input_path)
            root = tree.getroot()
            
            # Find and process all path elements
            for path_elem in root.findall(".//{http://www.w3.org/2000/svg}path"):
                d_attr = path_elem.attrib.get('d', '')
                if not d_attr:
                    continue
                
                subpaths = subpath_pattern.findall(d_attr)
                clean_subpaths = []
                
                for sp in subpaths:
                    match = first_y_pattern.search(sp)
                    if match:
                        start_y = float(match.group(2))
                        # In the internal coordinate system of these SVGs:
                        # - High Y (~6000-8000) represents the constellation/stars.
                        # - Low Y (< 2500) represents the text/labels along the bottom.
                        if start_y < threshold:
                            # Skip this subpath as it's part of the text/metadata
                            continue
                    
                    clean_subpaths.append(sp.strip())
                
                # Update the path data with only the constellation subpaths
                path_elem.set('d', " ".join(clean_subpaths))

            # Remove empty g or path elements if any were created (optional clean up)
            
            # Save the final result to the /final folder
            output_path = os.path.join(output_folder, filename)
            tree.write(output_path, encoding='utf-8', xml_declaration=True)
            print(f"Successfully cleaned: {filename}")
            
        except Exception as e:
            print(f"Error processing {filename}: {e}")

if __name__ == "__main__":
    # Process files from /inverted_zodiacs and output to /final
    remove_text_from_zodiacs()
