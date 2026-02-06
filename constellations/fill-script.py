import os
import xml.etree.ElementTree as ET
import re

# Register namespaces to ensure correct output and avoid "ns0" prefixes in output
ET.register_namespace('', "http://www.w3.org/2000/svg")

def fix_svg_final(folder_path):
    output_folder = os.path.join(folder_path, "inverted_zodiacs")
    if not os.path.exists(output_folder):
        os.makedirs(output_folder)

    # Regex to catch the background box and the potential first relative move
    # It accounts for optional commas and whitespace
    box_and_move_pattern = re.compile(
        r'M\s*0\s+4900[^z]*z\s*(m\s*(-?\d+\.?\d*)\s*[, \t]\s*(-?\d+\.?\d*))?', 
        re.IGNORECASE | re.DOTALL
    )

    for filename in os.listdir(folder_path):
        if not filename.endswith(".svg"):
            continue
            
        file_path = os.path.join(folder_path, filename)
        try:
            tree = ET.parse(file_path)
            root = tree.getroot()
            
            # 1. Groups & Fill
            for g in root.findall(".//{http://www.w3.org/2000/svg}g"):
                if g.attrib.get('fill') == "#000000":
                    g.set('fill', "#ffffff")
                
                paths = g.findall("{http://www.w3.org/2000/svg}path")
                if not paths:
                    continue
                
                combined_d_parts = []
                for p in paths:
                    d_orig = p.attrib.get('d', '')
                    
                    # Remove background box and fix the first move 
                    # by converting it to absolute start
                    match = box_and_move_pattern.search(d_orig)
                    if match:
                        if match.group(1): # If there was a trailing 'm'
                            rel_x = float(match.group(2))
                            rel_y = float(match.group(3))
                            abs_x = rel_x
                            abs_y = 4900 + rel_y
                            # Replace box+move with absolute M
                            d_clean = box_and_move_pattern.sub(f"M {abs_x} {abs_y} ", d_orig, count=1)
                        else:
                            # Just remove box
                            d_clean = box_and_move_pattern.sub("", d_orig, count=1)
                        combined_d_parts.append(d_clean.strip())
                    else:
                        combined_d_parts.append(d_orig.strip())
                    
                    g.remove(p)
                
                # 2. Combine all paths with evenodd
                if combined_d_parts:
                    new_d = " ".join(combined_d_parts)
                    new_path = ET.Element("{http://www.w3.org/2000/svg}path", {
                        "d": new_d,
                        "fill-rule": "evenodd"
                    })
                    g.append(new_path)

            # Save
            output_path = os.path.join(output_folder, filename)
            tree.write(output_path, encoding='utf-8', xml_declaration=True)
            print(f"Processed: {filename}")
            
        except Exception as e:
            print(f"Error processing {filename}: {e}")

if __name__ == "__main__":
    fix_svg_final('.')