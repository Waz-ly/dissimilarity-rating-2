import numpy as np
import os

if __name__ == "__main__":

    summed_matrix = None
    entries = 0

    for path, directories, files in os.walk("./data"):
        for file in files:
            if file.startswith("."):
                continue

            dissimilarity_matrix = np.loadtxt(os.path.join(path, file))
            summed_matrix = dissimilarity_matrix if summed_matrix is None else summed_matrix + dissimilarity_matrix
            entries += 1

    averaged_matrix = summed_matrix / entries
    np.savetxt("data/combined_dissimilarity_matrix.txt", averaged_matrix, fmt="%.2f", delimiter=" ")