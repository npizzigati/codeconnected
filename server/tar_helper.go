package main

import (
	"archive/tar"
	"bytes"
	"io"
	"time"
)

func makeTarball(contents []byte) (bytes.Buffer, error) {
	var tarBuffer bytes.Buffer
	err := createTar(contents, &tarBuffer)
	if err != nil {
		return tarBuffer, err
	}

	return tarBuffer, nil
}

func createTar(contents []byte, buffer io.Writer) error {
	tarWriter := tar.NewWriter(buffer)
	defer tarWriter.Close()

	err := addToTar(tarWriter, contents)
	if err != nil {
		return err
	}
	return nil
}

func addToTar(tarWriter *tar.Writer, contents []byte) error {
	header := &tar.Header{
		Name:       "code",
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
