package=native_protobuf
$(package)_version=21.12
$(package)_download_path=https://github.com/protocolbuffers/protobuf/releases/download/v$($(package)_version)
$(package)_file_name=protobuf-all-$($(package)_version).tar.gz
$(package)_sha256_hash=2c6a36c7b5a55accae063667ef3c55f2642e67476d96d355ff0acb13dbb47f09

define $(package)_set_vars
$(package)_config_opts=--disable-shared
$(package)_config_opts+=--enable-static
endef

define $(package)_config_cmds
  $($(package)_autoconf)
endef

define $(package)_build_cmds
  $(MAKE) -C src protoc
endef

define $(package)_stage_cmds
  $(MAKE) -C src DESTDIR=$($(package)_staging_dir) install-strip
endef

define $(package)_postprocess_cmds
  rm -rf lib include
endef
