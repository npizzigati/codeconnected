package main

import (
	"archive/tar"
	"bytes"
	"io"
	"time"
)

func makeTarball(contents []byte, filename string) (bytes.Buffer, error) {
	var tarBuffer bytes.Buffer
	err := createTar(contents, &tarBuffer, filename)
	if err != nil {
		return tarBuffer, err
	}

	return tarBuffer, nil
}

func createTar(contents []byte, buffer io.Writer, filename string) error {
	tarWriter := tar.NewWriter(buffer)
	defer tarWriter.Close()

	err := addToTar(tarWriter, contents, filename)
	if err != nil {
		return err
	}
	return nil
}

func addToTar(tarWriter *tar.Writer, contents []byte, filename string) error {
	header := &tar.Header{
		Name:       filename,
		Mode:       0777,
		Size:       int64(len(contents)),
		ModTime:    time.Now(),
		AccessTime: time.Now(),
		ChangeTime: time.Now(),
	}
	err := tarWriter.WriteHeader(header)
	if err != nil {
		return err
	}
	_, err = tarWriter.Write(contents)
	if err != nil {
		return err
	}
	return nil
}
